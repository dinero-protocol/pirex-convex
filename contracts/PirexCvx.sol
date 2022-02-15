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

    struct EarnedData {
        address token;
        uint256 amount;
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

    function getReward(address _account, bool _stake) external;

    function claimableRewards(address _account)
        external
        view
        returns (EarnedData[] memory userRewards);
}

interface IcvxRewardPool {
    function stake(uint256 _amount) external;

    function withdraw(uint256 _amount, bool claim) external;
}

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

interface IVotiumMultiMerkleStash {
    function claim(
        address token,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external;
}

interface IVotiumRewardManager {
    function manage(address token, uint256 amount)
        external
        returns (address newToken, uint256 newTokenAmount);
}

contract PirexCvx is Ownable {
    using SafeERC20 for IERC20;
    using Strings for uint256;

    struct Deposit {
        uint256 lockExpiry;
        address token;
    }

    struct Reward {
        address token;
        uint256 amount;
    }

    address public cvxLocker;
    address public cvx;
    address public cvxRewardPool;
    address public cvxDelegateRegistry;
    address public votiumMultiMerkleStash;
    uint256 public epochDepositDuration;
    uint256 public lockDuration;
    address public immutable erc20Implementation;
    address public voteDelegate;
    address public votiumRewardManager;

    mapping(uint256 => Deposit) public deposits;

    // Voter bribes
    mapping(uint256 => Reward[]) public voteEpochRewards;

    // Convex emissions and extra rewards
    mapping(uint256 => Reward[]) public epochRewards;

    event VoteDelegateSet(bytes32 id, address delegate);
    event VotiumRewardManagerSet(address manager);

    // Epoch mapped to vote token addresses
    mapping(uint256 => address) public voteEpochs;

    // Epoch mapped to reward token addresses
    mapping(uint256 => address) public rewardEpochs;

    event Deposited(
        uint256 amount,
        uint256 spendRatio,
        uint256 epoch,
        uint256 lockExpiry,
        address token,
        uint256[8] epochs
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
    event VotiumRewardClaimed(
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] merkleProof,
        uint256 voteEpoch,
        uint256 voteEpochRewardsIndex,
        address manager,
        address managerToken,
        uint256 managerTokenAmount
    );
    event VoteEpochRewardsClaimed(
        address[] tokens,
        uint256[] amounts,
        uint256[] remaining
    );

    constructor(
        address _cvxLocker,
        address _cvx,
        address _cvxRewardPool,
        address _cvxDelegateRegistry,
        address _votiumMultiMerkleStash,
        uint256 _epochDepositDuration,
        uint256 _lockDuration,
        address _voteDelegate
    ) {
        require(_cvxLocker != address(0), "Invalid _cvxLocker");
        cvxLocker = _cvxLocker;

        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;

        require(_cvxRewardPool != address(0), "Invalid _cvxRewardPool");
        cvxRewardPool = _cvxRewardPool;

        require(
            _cvxDelegateRegistry != address(0),
            "Invalid _cvxDelegateRegistry"
        );
        cvxDelegateRegistry = _cvxDelegateRegistry;

        require(_votiumMultiMerkleStash != address(0));
        votiumMultiMerkleStash = _votiumMultiMerkleStash;

        require(_epochDepositDuration > 0, "Invalid _epochDepositDuration");
        epochDepositDuration = _epochDepositDuration;

        require(_lockDuration > 0, "Invalid _lockDuration");
        lockDuration = _lockDuration;

        require(_voteDelegate != address(0), "Invalid _voteDelegate");
        voteDelegate = _voteDelegate;

        // Default reward manager
        votiumRewardManager = address(this);

        erc20Implementation = address(new ERC20PresetMinterPauserUpgradeable());
    }

    /**
        @notice Restricts calls to owner or votiumRewardManager
     */
    modifier onlyVotiumRewardManager() {
        require(
            msg.sender == owner() || msg.sender == votiumRewardManager,
            "Must be owner or votiumRewardManager"
        );

        _;
    }

    /**
        @notice Set vote delegate
        @param  id        bytes32  Id from Convex when setting delegate
        @param  delegate  address  Account to delegate votes to
     */
    function setVoteDelegate(bytes32 id, address delegate) external onlyOwner {
        require(delegate != address(0), "Invalid delegate");
        voteDelegate = delegate;

        IConvexDelegateRegistry(cvxDelegateRegistry).setDelegate(
            id,
            voteDelegate
        );

        emit VoteDelegateSet(id, voteDelegate);
    }

    /**
        @notice Set Votium reward manager
        @param  manager  address  Reward manager
     */
    function setVotiumRewardManager(address manager) external onlyOwner {
        require(manager != address(0), "Invalid manager");
        votiumRewardManager = manager;

        emit VotiumRewardManagerSet(votiumRewardManager);
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
        uint256[8] memory epochs = mintVoteAndRewardCvx(
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
            epochs
        );
    }

    /**
        @notice Reusable method for minting different types of CVX tokens
        @param  token      address  Token address if it already exists
        @param  tokenId    string   Token name/symbol
        @param  recipient  address  Account receiving tokens
        @param  amount     uint256  Amount of tokens to mint account
     */
    function mintCvx(
        address token,
        string memory tokenId,
        address recipient,
        uint256 amount
    ) internal returns (address) {
        require(bytes(tokenId).length > 0, "Invalid tokenId");
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Invalid amount");

        // If token does not yet exist, create new
        if (token == address(0)) {
            ERC20PresetMinterPauserUpgradeable _erc20 = ERC20PresetMinterPauserUpgradeable(
                    Clones.clone(erc20Implementation)
                );

            _erc20.initialize(tokenId, tokenId);
            _erc20.mint(recipient, amount);

            return address(_erc20);
        }

        ERC20PresetMinterPauserUpgradeable(token).mint(recipient, amount);

        return token;
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
        string memory tokenId = string(
            abi.encodePacked("lockedCVX-", epoch.toString())
        );
        Deposit memory d = deposits[epoch];

        return mintCvx(d.token, tokenId, recipient, amount);
    }

    /**
        @notice Mints voteCVX and rewardCVX
        @param  recipient     uint256     Account receiving voteCVX and rewardCVX
        @param  amount        uint256     Amount of voteCVX and rewardCVX
        @param  depositEpoch  uint256     Epoch that user deposited CVX
        @return epochs        uint256[8]  Epochs for both tokens
     */
    function mintVoteAndRewardCvx(
        address recipient,
        uint256 amount,
        uint256 depositEpoch
    ) internal returns (uint256[8] memory epochs) {
        // Users can only vote/claim rewards in subsequent epochs (after deposit epoch)
        uint256 startingEpoch = depositEpoch + epochDepositDuration;

        // Mint 1 voteCVX for each Convex gauge weight proposal that users can vote on
        // Mint 1 rewardCVX for each reward-claiming period (every 2 weeks)
        for (uint8 i = 0; i < 8; i += 1) {
            uint256 epoch = startingEpoch + (epochDepositDuration * i);

            epochs[i] = epoch;

            string memory voteCvxId = string(
                abi.encodePacked("voteCVX-", epoch.toString())
            );
            string memory rewardCvxId = string(
                abi.encodePacked("rewardCVX-", epoch.toString())
            );
            address voteCvx = voteEpochs[epoch];
            address rewardCvx = rewardEpochs[epoch];
            address mintedVoteCvx = mintCvx(
                voteCvx,
                voteCvxId,
                recipient,
                amount
            );
            address mintedRewardCvx = mintCvx(
                rewardCvx,
                rewardCvxId,
                recipient,
                amount
            );

            // Only modify storage if necessary
            // If voteCvx is zero address, so is rewardCvx, since they're minted at the same time
            if (voteCvx == address(0) && rewardCvx == address(0)) {
                voteEpochs[epoch] = mintedVoteCvx;
                rewardEpochs[epoch] = mintedRewardCvx;
            }
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

    /**
        @notice Claim Votium reward
        @param  token        address   Reward token address
        @param  index        uint256   Merkle tree node index
        @param  amount       uint256   Reward token amount
        @param  merkleProof  bytes2[]  Merkle proof
        @param  voteEpoch    uint256   Vote epoch associated with rewards
     */
    function claimVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof,
        uint256 voteEpoch
    ) external onlyVotiumRewardManager {
        require(voteEpoch > 0, "Invalid voteEpoch");
        require(
            voteEpoch < getCurrentEpoch(),
            "voteEpoch must be previous epoch"
        );
        require(voteEpochs[voteEpoch] != address(0), "Invalid voteEpoch");

        IVotiumMultiMerkleStash(votiumMultiMerkleStash).claim(
            token,
            index,
            address(this),
            amount,
            merkleProof
        );

        Reward[] storage v = voteEpochRewards[voteEpoch];

        address managerToken;
        uint256 managerTokenAmount;

        // Default to storing vote epoch rewards as-is if default reward manager is set
        if (address(this) == votiumRewardManager) {
            v.push(Reward(token, amount));
        } else {
            IERC20(token).safeIncreaseAllowance(votiumRewardManager, amount);

            // Doesn't actually do anything for MVP besides demonstrate call flow
            (managerToken, managerTokenAmount) = IVotiumRewardManager(
                votiumRewardManager
            ).manage(token, amount);

            v.push(Reward(managerToken, managerTokenAmount));
        }

        emit VotiumRewardClaimed(
            token,
            index,
            amount,
            merkleProof,
            voteEpoch,
            v.length - 1,
            votiumRewardManager,
            managerToken,
            managerTokenAmount
        );
    }

    /**
        @notice Claim Votium rewards for user
        @param  voteEpoch    uint256   Vote epoch associated with rewards
     */
    function claimVoteEpochRewards(uint256 voteEpoch) external {
        Reward[] storage v = voteEpochRewards[voteEpoch];
        require(v.length > 0, "No rewards to claim");

        // If there are claimable rewards, there has to be a vote epoch token set
        address voteEpochToken = voteEpochs[voteEpoch];
        assert(voteEpochToken != address(0));

        ERC20PresetMinterPauserUpgradeable voteCvx = ERC20PresetMinterPauserUpgradeable(
                voteEpochToken
            );
        uint256 voteCvxBalance = voteCvx.balanceOf(msg.sender);
        require(
            voteCvxBalance > 0,
            "Msg.sender does not have voteCVX for epoch"
        );

        uint256 voteCvxSupply = voteCvx.totalSupply();
        address[] memory rewardTokens = new address[](v.length);
        uint256[] memory rewardTokenAmounts = new uint256[](v.length);
        uint256[] memory rewardTokenAmountsRemaining = new uint256[](v.length);

        voteCvx.burnFrom(msg.sender, voteCvxBalance);

        for (uint256 i = 0; i < v.length; i += 1) {
            // The reward amount is calculated using the user's % voteCVX ownership for the vote epoch
            // E.g. Owning 10% of voteCVX tokens means they'll get 10% of the rewards
            uint256 rewardAmount = (v[i].amount * voteCvxBalance) /
                voteCvxSupply;

            rewardTokens[i] = v[i].token;
            rewardTokenAmounts[i] = rewardAmount;
            rewardTokenAmountsRemaining[i] = v[i].amount - rewardAmount;
            v[i].amount = rewardTokenAmountsRemaining[i];

            IERC20(rewardTokens[i]).safeTransfer(
                msg.sender,
                rewardTokenAmounts[i]
            );
        }

        emit VoteEpochRewardsClaimed(
            rewardTokens,
            rewardTokenAmounts,
            rewardTokenAmountsRemaining
        );
    }

    /**
        @notice Claim and stake cvxCRV reward
     */
    function claimAndStakeCvxCrvReward()
        external
        returns (ICvxLocker.EarnedData[] memory claimed)
    {
        ICvxLocker c = ICvxLocker(cvxLocker);
        claimed = c.claimableRewards(address(this));

        ICvxLocker(cvxLocker).getReward(address(this), true);
    }
}
