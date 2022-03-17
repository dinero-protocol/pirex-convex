// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface ICvxRewardPool {
    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function extraRewardsLength() external view returns (uint256);

    function addExtraReward(address _reward) external;

    function clearExtraRewards() external;

    function lastTimeRewardApplicable() external view returns (uint256);

    function rewardPerToken() external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function stake(uint256 _amount) external;

    function stakeAll() external;

    function stakeFor(address _for, uint256 _amount) external;

    function withdraw(uint256 _amount, bool claim) external;

    function withdrawAll(bool claim) external;

    function getReward(
        address _account,
        bool _claimExtras,
        bool _stake
    ) external;

    function getReward(bool _stake) external;

    function donate(uint256 _amount) external returns (bool);

    function queueNewRewards(uint256 _rewards) external;

    function notifyRewardAmount(uint256 reward) external;
}
