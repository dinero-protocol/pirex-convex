// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// https://docs.synthetix.io/contracts/source/contracts/StakingRewards/
// https://github.com/Synthetixio/synthetix/blob/v2.66.0/contracts/StakingRewards.sol
/**
  Modifications
    - Pin pragma to 0.8.12
    - Remove IStakingRewards, RewardsDistributionRecipient, and Pausable
    - Add and inherit from Ownable
    - Add `RewardsDistributionRecipient` logic to contract
    - Add `vault` state variable and `onlyVault` modifier
    - Add `onlyVault` modifier to `stake` method
    - Change `rewardsDuration` to 14 days
    - Update contract to support only the vault as a user
    - Remove SafeMath since pragma 0.8.0 has those checks built-in
    - Replace OpenZeppelin ERC20, ReentrancyGuard, and SafeERC20 with Solmate v6 (audited)
    - Consolidate `rewardsToken` and `stakingToken` since they're the same
    - Remove `onlyVault` modifier from getReward
    - Remove ReentrancyGuard as it is no longer needed
    - Add `totalSupplyWithRewards` method to save gas as _totalSupply + rewards are accessed by vault
*/
contract UnionPirexStaking is Ownable {
    using SafeTransferLib for ERC20;

    /* ========== STATE VARIABLES ========== */

    address public immutable vault;
    ERC20 public immutable token;

    uint256 public constant rewardsDuration = 14 days;

    address public distributor;
    uint256 public periodFinish;
    uint256 public rewardRate;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;
    uint256 public userRewardPerTokenPaid;
    uint256 public rewards;

    uint256 internal _totalSupply;

    /* ========== CONSTRUCTOR ========== */

    constructor(
        address _token,
        address _distributor,
        address _vault
    ) {
        token = ERC20(_token);
        distributor = _distributor;
        vault = _vault;
    }

    /* ========== VIEWS ========== */

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function totalSupplyWithRewards() external view returns (uint256, uint256) {
        uint256 t = _totalSupply;

        return (
            t,
            ((t * (rewardPerToken() - userRewardPerTokenPaid)) / 1e18) + rewards
        );
    }

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (_totalSupply == 0) {
            return rewardPerTokenStored;
        }

        return
            rewardPerTokenStored +
            ((((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate) *
                1e18) / _totalSupply);
    }

    function earned() public view returns (uint256) {
        return
            ((_totalSupply * (rewardPerToken() - userRewardPerTokenPaid)) /
                1e18) + rewards;
    }

    function getRewardForDuration() external view returns (uint256) {
        return rewardRate * rewardsDuration;
    }

    /* ========== MUTATIVE FUNCTIONS ========== */

    function stake(uint256 amount) external onlyVault updateReward(vault) {
        require(amount > 0, "Cannot stake 0");
        _totalSupply += amount;
        token.safeTransferFrom(vault, address(this), amount);
        emit Staked(amount);
    }

    function withdraw(uint256 amount) external onlyVault updateReward(vault) {
        require(amount > 0, "Cannot withdraw 0");
        _totalSupply -= amount;
        token.safeTransfer(vault, amount);
        emit Withdrawn(amount);
    }

    function getReward() external updateReward(vault) {
        uint256 reward = rewards;

        if (reward > 0) {
            rewards = 0;
            token.safeTransfer(vault, reward);
            emit RewardPaid(reward);
        }
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function notifyRewardAmount()
        external
        onlyDistributor
        updateReward(address(0))
    {
        // Rewards transferred directly to this contract are not added to _totalSupply
        // To get the rewards w/o relying on a potentially incorrect passed in arg,
        // we can use the difference between the token balance and _totalSupply
        uint256 rewardBalance = token.balanceOf(address(this)) - _totalSupply;

        if (block.timestamp >= periodFinish) {
            // Deduct earned rewards so that they are not doubly distributed
            uint256 newRewards = rewardBalance - earned();
            require(newRewards > rewardsDuration, "No rewards");

            rewardRate = newRewards / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;

            // Deduct previous rewards transfer so that they are not doubly distributed
            uint256 newRewards = rewardBalance - (leftover + earned());
            require(newRewards > rewardsDuration, "No rewards");

            rewardRate = (newRewards + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        require(
            rewardRate <= rewardBalance / rewardsDuration,
            "Provided reward too high"
        );

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(rewardBalance);
    }

    // Added to support recovering LP Rewards from other systems such as BAL to be distributed to holders
    function recoverERC20(address tokenAddress, uint256 tokenAmount)
        external
        onlyOwner
    {
        require(
            tokenAddress != address(token),
            "Cannot withdraw the staking token"
        );
        ERC20(tokenAddress).safeTransfer(owner(), tokenAmount);
        emit Recovered(tokenAddress, tokenAmount);
    }

    function setDistributor(address _distributor) external onlyOwner {
        require(_distributor != address(0));
        distributor = _distributor;
    }

    /* ========== MODIFIERS ========== */

    modifier updateReward(address account) {
        rewardPerTokenStored = rewardPerToken();
        lastUpdateTime = lastTimeRewardApplicable();
        if (account != address(0)) {
            rewards = earned();
            userRewardPerTokenPaid = rewardPerTokenStored;
        }
        _;
    }

    /* ========== EVENTS ========== */

    event RewardAdded(uint256 reward);
    event Staked(uint256 amount);
    event Withdrawn(uint256 amount);
    event RewardPaid(uint256 reward);
    event Recovered(address token, uint256 amount);

    modifier onlyDistributor() {
        require((msg.sender == distributor), "Distributor only");
        _;
    }

    modifier onlyVault() {
        require((msg.sender == vault), "Vault only");
        _;
    }
}
