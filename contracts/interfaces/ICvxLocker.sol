// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface ICvxLocker {
    struct Reward {
        bool useBoost;
        uint40 periodFinish;
        uint208 rewardRate;
        uint40 lastUpdateTime;
        uint208 rewardPerTokenStored;
    }
    struct Balances {
        uint112 locked;
        uint112 boosted;
        uint32 nextUnlockIndex;
    }
    struct LockedBalance {
        uint112 amount;
        uint112 boosted;
        uint32 unlockTime;
    }
    struct EarnedData {
        address token;
        uint256 amount;
    }
    struct Epoch {
        uint224 supply; //epoch boosted supply
        uint32 date; //epoch start date
    }

    function decimals() external view returns (uint8);

    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function addReward(
        address _rewardsToken,
        address _distributor,
        bool _useBoost
    ) external;

    function approveRewardDistributor(
        address _rewardsToken,
        address _distributor,
        bool _approved
    ) external;

    function setStakingContract(address _staking) external;

    function setStakeLimits(uint256 _minimum, uint256 _maximum) external;

    function setBoost(
        uint256 _max,
        uint256 _rate,
        address _receivingAddress
    ) external;

    function setKickIncentive(uint256 _rate, uint256 _delay) external;

    function shutdown() external;

    function setApprovals() external;

    function lastTimeRewardApplicable(address _rewardsToken)
        external
        view
        returns (uint256);

    function rewardPerToken(address _rewardsToken)
        external
        view
        returns (uint256);

    function getRewardForDuration(address _rewardsToken)
        external
        view
        returns (uint256);

    function claimableRewards(address _account)
        external
        view
        returns (EarnedData[] memory userRewards);

    function rewardWeightOf(address _user)
        external
        view
        returns (uint256 amount);

    function lockedBalanceOf(address _user)
        external
        view
        returns (uint256 amount);

    function balanceOf(address _user) external view returns (uint256 amount);

    function balanceAtEpochOf(uint256 _epoch, address _user)
        external
        view
        returns (uint256 amount);

    function totalSupply() external view returns (uint256 supply);

    function totalSupplyAtEpoch(uint256 _epoch)
        external
        view
        returns (uint256 supply);

    function findEpochId(uint256 _time) external view returns (uint256 epoch);

    function lockedBalances(address _user)
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            LockedBalance[] memory lockData
        );

    //number of epochs
    function epochCount() external view returns (uint256);

    function checkpointEpoch() external;

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

    function processExpiredLocks(bool _relock) external;

    function kickExpiredLocks(address _account) external;

    function getReward(address _account, bool _stake) external;

    function getReward(address _account) external;

    function notifyRewardAmount(address _rewardsToken, uint256 _reward)
        external;

    function recoverERC20(address _tokenAddress, uint256 _tokenAmount) external;
}
