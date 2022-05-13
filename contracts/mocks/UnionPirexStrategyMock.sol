// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {UnionPirexStrategy} from "../vault/UnionPirexStrategy.sol";

contract UnionPirexStrategyMock is UnionPirexStrategy {
    /**
        @param  _pirexCvx     address  PirexCvx contract
        @param  _pxCVX        address  PxCvx contract
        @param  _distributor  address  Reward distributor
        @param  _vault        address  UnionPirexVault contract
     */
    constructor(
        address _pirexCvx,
        address _pxCVX,
        address _distributor,
        address _vault
    ) UnionPirexStrategy(_pirexCvx, _pxCVX, _distributor, _vault) {}

    function notifyRewardAmountProblematic()
        external
        onlyDistributor
        updateReward(address(0))
    {
        // Rewards transferred directly to this contract are not added to _totalSupply
        // To get the rewards w/o relying on a potentially incorrect passed in arg,
        // we can use the difference between the token balance and _totalSupply
        uint256 reward = token.balanceOf(address(this)) - _totalSupply;

        if (block.timestamp >= periodFinish) {
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        uint256 balance = token.balanceOf(address(this));
        require(
            rewardRate <= balance / rewardsDuration,
            "Provided reward too high"
        );

        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardAdded(reward);
    }

    function getRewardsDuration() external pure returns (uint256) {
        return rewardsDuration;
    }
}
