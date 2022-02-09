// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20PresetMinterPauserUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

interface ICvxLocker {
    struct LockedBalance {
        uint112 amount;
        uint112 boosted;
        uint32 unlockTime;
    }

    function lock(
        address _account,
        uint256 _amount,
        uint256 _spendRatio
    ) external;

    function processExpiredLocks(
        bool _relock,
        uint256 _spendRatio,
        address _withdrawTo
    ) external;

    function lockedBalances(address _user)
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            LockedBalance[] memory lockData
        );
}

interface IcvxRewardPool {
    function stake(uint256 _amount) external;

    function withdraw(uint256 _amount, bool claim) external;
}

contract PirexCvx is Ownable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    struct Deposit {
        uint256 lockExpiry;
        address token;
    }

    address public cvxLocker;
    address public cvx;
    address public cvxRewardPool;
    uint256 public epochDepositDuration;
    uint256 public lockDuration;
    address public immutable erc20Implementation;

    mapping(uint256 => Deposit) public deposits;

    // Epoch mapped to vote token addresses
    mapping(uint256 => address) public voteEpochs;

    event Deposited(
        uint256 amount,
        uint256 spendRatio,
        uint256 epoch,
        uint256 lockExpiry,
        address token,
        uint256[8] voteEpochs
    );
    event Withdrew(
        uint256 amount,
        uint256 spendRatio,
        uint256 epoch,
        uint256 lockExpiry,
        address token,
        uint256 unlocked,
        uint256 staked
    );
    event Staked(uint256 amount);
    event Unstaked(uint256 amount);

    constructor(
        address _cvxLocker,
        address _cvx,
        address _cvxRewardPool,
        uint256 _epochDepositDuration,
        uint256 _lockDuration
    ) {
        require(_cvxLocker != address(0), "Invalid _cvxLocker");
        cvxLocker = _cvxLocker;

        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;

        require(_cvxRewardPool != address(0), "Invalid _cvxRewardPool");
        cvxRewardPool = _cvxRewardPool;

        require(_epochDepositDuration > 0, "Invalid _epochDepositDuration");
        epochDepositDuration = _epochDepositDuration;

        require(_lockDuration > 0, "Invalid _lockDuration");
        lockDuration = _lockDuration;

        erc20Implementation = address(new ERC20PresetMinterPauserUpgradeable());
    }

    /**
        @notice Get current epoch
        @return uint256 Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp / epochDepositDuration) * epochDepositDuration;
    }

    /**
        @notice Deposit CVX into our protocol
        @param  amount      uint256  CVX amount
        @param  spendRatio  uint256  Used to calculate the spend amount and boost ratio
     */
    function deposit(uint256 amount, uint256 spendRatio) external {
        require(amount > 0, "Invalid amount");

        // CvxLocker transfers CVX from msg.sender (this contract) to itself
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), amount);

        IERC20(cvx).safeIncreaseAllowance(cvxLocker, amount);
        ICvxLocker(cvxLocker).lock(address(this), amount, spendRatio);

        // Deposit periods are every 2 weeks
        uint256 currentEpoch = getCurrentEpoch();

        Deposit storage d = deposits[currentEpoch];

        // CVX can be withdrawn 17 weeks *after the end of the epoch*
        uint256 lockExpiry = currentEpoch + epochDepositDuration + lockDuration;
        address token = mintLockedCvx(msg.sender, amount, currentEpoch);
        uint256[8] memory _voteEpochs = mintVoteCvx(
            msg.sender,
            amount,
            currentEpoch
        );

        if (d.lockExpiry == 0) {
            d.lockExpiry = lockExpiry;
            d.token = token;
        }

        assert(d.lockExpiry != 0);
        assert(d.token != address(0));

        emit Deposited(
            amount,
            spendRatio,
            currentEpoch,
            lockExpiry,
            token,
            _voteEpochs
        );
    }

    /**
        @notice Mints locked CVX
        @param  recipient  uint256  Account receiving lockedCVX
        @param  amount     uint256  Amount of lockedCVX
        @param  epoch      uint256  Epoch to mint lockedCVX for
     */
    function mintLockedCvx(
        address recipient,
        uint256 amount,
        uint256 epoch
    ) internal returns (address) {
        string memory name = string(
            abi.encodePacked("lockedCVX-", epoch.toString())
        );
        Deposit memory d = deposits[epoch];

        if (d.token != address(0)) {
            ERC20PresetMinterPauserUpgradeable(d.token).mint(recipient, amount);

            return d.token;
        }

        // Create a new lockedCVX token for current epoch if it doesn't exist
        ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                Clones.clone(erc20Implementation)
            );

        _erc20.initialize(name, name);
        _erc20.mint(recipient, amount);

        return address(_erc20);
    }

    /**
        @notice Mints voteCVX
        @param  recipient  uint256  Account receiving voteCVX
        @param  amount     uint256  Amount of voteCVX
        @param  epoch      uint256  Epoch to mint voteCVX for
     */
    function mintVoteCvx(
        address recipient,
        uint256 amount,
        uint256 epoch
    ) internal returns (uint256[8] memory _voteEpochs) {
        uint256 firstVoteEpoch = epoch + epochDepositDuration;

        for (uint8 i = 0; i < 8; i += 1) {
            uint256 voteEpoch = firstVoteEpoch + (epochDepositDuration * i);

            _voteEpochs[i] = voteEpoch;

            string memory name = string(
                abi.encodePacked("voteCVX-", voteEpoch.toString())
            );

            address voteToken = voteEpochs[voteEpoch];

            if (voteToken != address(0)) {
                ERC20PresetMinterPauserUpgradeable(voteToken).mint(
                    recipient,
                    amount
                );

                continue;
            }

            // Create a new voteCVX token for current epoch if it doesn't exist
            ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                    Clones.clone(erc20Implementation)
                );

            _erc20.initialize(name, name);
            _erc20.mint(recipient, amount);

            voteEpochs[voteEpoch] = address(_erc20);
        }
    }

    /**
        @notice Withdraw deposit
        @param  epoch       uint256  Epoch to withdraw locked CVX for
        @param  spendRatio  uint256  Used to calculate the spend amount and boost ratio
     */
    function withdraw(uint256 epoch, uint256 spendRatio) external {
        Deposit memory d = deposits[epoch];
        require(d.lockExpiry > 0 && d.token != address(0), "Invalid epoch");
        require(
            d.lockExpiry <= block.timestamp,
            "Cannot withdraw before lock expiry"
        );

        ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                d.token
            );
        uint256 epochTokenBalance = _erc20.balanceOf(msg.sender);
        require(
            epochTokenBalance > 0,
            "Msg.sender does not have lockedCVX for epoch"
        );

        // Burn user lockedCVX
        _erc20.burnFrom(msg.sender, epochTokenBalance);

        uint256 unlocked = unlockCvx(spendRatio);

        // Unstake CVX if we do not have enough to complete withdrawal
        if (unlocked < epochTokenBalance) {
            unstakeCvx(epochTokenBalance - unlocked);
        }

        // Send msg.sender CVX equal to the amount of their epoch token balance
        IERC20(cvx).safeTransfer(msg.sender, epochTokenBalance);

        uint256 stakeableCvx = IERC20(cvx).balanceOf(address(this));

        // Stake remaining CVX to keep assets productive
        if (stakeableCvx > 0) {
            stakeCvx(stakeableCvx);
        }

        emit Withdrew(
            epochTokenBalance,
            spendRatio,
            epoch,
            d.lockExpiry,
            d.token,
            unlocked,
            stakeableCvx
        );
    }

    /**
        @notice Unlock CVX (if any)
        @param  spendRatio  uint256  Used to calculate the spend amount and boost ratio
        @return unlocked    uint256  Amount of unlocked CVX
     */
    function unlockCvx(uint256 spendRatio) public returns (uint256 unlocked) {
        ICvxLocker _cvxLocker = ICvxLocker(cvxLocker);
        (, uint256 unlockable, , ) = _cvxLocker.lockedBalances(address(this));

        // Withdraw all unlockable tokens
        if (unlockable > 0) {
            _cvxLocker.processExpiredLocks(false, spendRatio, address(this));
        }

        return unlockable;
    }

    /**
        @notice Stake CVX
        @param  amount  uint256  Amount of CVX to stake
     */
    function stakeCvx(uint256 amount) public {
        require(amount > 0, "Invalid amount");

        IERC20(cvx).safeIncreaseAllowance(cvxRewardPool, amount);
        IcvxRewardPool(cvxRewardPool).stake(amount);

        emit Staked(amount);
    }

    /**
        @notice Unstake CVX
        @param  amount  uint256  Amount of CVX to unstake
     */
    function unstakeCvx(uint256 amount) public {
        require(amount > 0, "Invalid amount");

        IcvxRewardPool(cvxRewardPool).withdraw(amount, false);

        emit Unstaked(amount);
    }
}