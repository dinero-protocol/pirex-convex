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

    event Deposited(
        uint256 amount,
        uint256 spendRatio,
        uint256 epoch,
        uint256 lockExpiry,
        address token
    );
    event Withdrew(
        uint256 amount,
        uint256 spendRatio,
        uint256 epoch,
        uint256 lockExpiry,
        address token
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

        // Necessary as CvxLocker's lock method uses msg.sender when transferring
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), amount);

        IERC20(cvx).safeIncreaseAllowance(cvxLocker, amount);
        ICvxLocker(cvxLocker).lock(address(this), amount, spendRatio);

        // Periods during which users can deposit CVX are every 2 weeks (i.e. epochs)
        uint256 currentEpoch = getCurrentEpoch();

        Deposit storage d = deposits[currentEpoch];

        address token = mintVoteLockedCvx(msg.sender, amount, currentEpoch);

        if (d.lockExpiry == 0) {
            // CVX can be withdrawn 17 weeks after the end of the epoch
            d.lockExpiry = currentEpoch + epochDepositDuration + lockDuration;
            d.token = token;
        }

        emit Deposited(amount, spendRatio, currentEpoch, d.lockExpiry, d.token);
    }

    /**
        @notice Mints vlCVX
        @param  recipient  uint256  Account receiving vlCVX
        @param  amount     uint256  Amount of vlCVX
        @param  epoch      uint256  Epoch to mint vlCVX for
     */
    function mintVoteLockedCvx(
        address recipient,
        uint256 amount,
        uint256 epoch
    ) internal returns (address) {
        string memory name = string(
            abi.encodePacked("vlCVX-", epoch.toString())
        );
        Deposit memory d = deposits[epoch];

        if (d.token != address(0)) {
            ERC20PresetMinterPauserUpgradeable(d.token).mint(recipient, amount);

            return d.token;
        }

        // Create a new vlCVX token for current epoch if it doesn't exist
        ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                Clones.clone(erc20Implementation)
            );

        _erc20.initialize(name, name);
        _erc20.mint(recipient, amount);

        return address(_erc20);
    }

    /**
        @notice Withdraw deposit
        @param  epoch       uint256  Epoch to mint vlCVX for
        @param  spendRatio  uint256  Used to calculate the spend amount and boost ratio
     */
    function withdraw(uint256 epoch, uint256 spendRatio) external {
        Deposit memory d = deposits[epoch];
        require(
            d.lockExpiry <= block.timestamp,
            "Cannot withdraw before lock expiry"
        );

        ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                d.token
            );
        uint256 epochTokenBalance = _erc20.balanceOf(msg.sender);
        require(epochTokenBalance > 0, "Sender does not have vlCVX for epoch");

        // Burn user vlCVX
        _erc20.burnFrom(msg.sender, epochTokenBalance);

        IERC20 _cvx = IERC20(cvx);
        uint256 cvxBalance = _cvx.balanceOf(address(this));

        // Only unlock CVX if contract does not have enough for withdrawal
        if (cvxBalance < epochTokenBalance) {
            unlockCvx(spendRatio);

            // TODO: Unstake CVX if unlocked balance is not enough
            // If unlocked balance is greater than epochTokenBalance, stake remainder
        }

        // Send msg.sender CVX equal to the amount of their epoch token balance
        _cvx.safeIncreaseAllowance(address(this), epochTokenBalance);
        _cvx.safeTransferFrom(address(this), msg.sender, epochTokenBalance);

        emit Withdrew(
            epochTokenBalance,
            spendRatio,
            epoch,
            d.lockExpiry,
            d.token
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
     */
    function stakeCvx() public {
        uint256 balance = IERC20(cvx).balanceOf(address(this));

        IERC20(cvx).safeIncreaseAllowance(cvxRewardPool, balance);
        IcvxRewardPool(cvxRewardPool).stake(balance);

        emit Staked(balance);
    }

    /**
        @notice Stake CVX
        @param  amount  uint256  Amount of CVX to unstake
     */
    function unstakeCvx(uint256 amount) public {
        IcvxRewardPool(cvxRewardPool).withdraw(amount, false);

        emit Unstaked(amount);
    }
}
