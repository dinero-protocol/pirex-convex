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

    /**
        @notice Problematic version of `notifyRewardAmount` susceptible to erroneous 
                reward distribution if not called correctly by the distributor.
     */
    function notifyRewardAmountProblematic()
        external
        onlyDistributor
        updateReward(address(0))
    {
        // @NOTE: Comments pre-fixed with NOTE will detail issues while preserving code

        // Rewards transferred directly to this contract are not added to _totalSupply
        // To get the rewards w/o relying on a potentially incorrect passed in arg,
        // we can use the difference between the token balance and _totalSupply
        uint256 reward = token.balanceOf(address(this)) - _totalSupply;

        if (block.timestamp >= periodFinish) {
            // @NOTE: Earned, unclaimed rewards they will be doubly distributed if not deducted
            rewardRate = reward / rewardsDuration;
        } else {
            uint256 remaining = periodFinish - block.timestamp;
            uint256 leftover = remaining * rewardRate;

            // @NOTE: If the new reward amount is not singled out before adding leftovers, then
            // any leftovers and earned, unclaimed rewards will be doubly distributed
            rewardRate = (reward + leftover) / rewardsDuration;
        }

        // Ensure the provided reward amount is not more than the balance in the contract.
        // This keeps the reward rate in the right range, preventing overflows due to
        // very high values of rewardRate in the earned and rewardsPerToken functions;
        // Reward + leftover must be less than 2^256 / 10^18 to avoid overflow.
        // @NOTE: This check is insufficient as it should not include the non-reward balance
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
