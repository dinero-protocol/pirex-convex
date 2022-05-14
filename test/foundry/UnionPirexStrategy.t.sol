// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {HelperContract} from "./HelperContract.sol";

contract UnionPirexStrategy is Test, HelperContract {
    uint256 private immutable rewardsDuration;
    uint256 private seedAmount = 1e18;
    bytes private constant NO_REWARDS_ERROR_MSG = bytes("No rewards");

    constructor() {
        rewardsDuration = unionPirexStrategy.getRewardsDuration();
    }

    function setUp() external {
        // Deposit CVX to seed vault with a non-zero totalSupply and balance
        _mintAndDepositCVX(seedAmount, address(this), true, true);

        // Deposit CVX and mint pxCVX which will be deposited as rewards
        _mintAndDepositCVX(seedAmount, address(this), false, true);

        // Transfer pxCVX to strategy contract and notify rewards
        pxCvx.transfer(address(unionPirexStrategy), 1e18);
    }

    /**
        @notice Reproduce the potential issue of notifyRewardAmount issuing invalid rewards
     */
    function testNotifyRewardAmountProblematic() external {
        unionPirexStrategy.notifyRewardAmountProblematic();

        // Warp forward to ensure full amount is reflected when calling `earned`
        vm.warp(block.timestamp + rewardsDuration);

        // Total amount of rewards meant to be distributed after a rewardsDuration (14 days)
        uint256 singleRewards = unionPirexStrategy.earned();

        // Call `notifyRewardAmount` again to verify rewards increases w/o additional pxCVX
        unionPirexStrategy.notifyRewardAmountProblematic();

        // Warp forward to ensure full amount is reflected when calling `earned`
        vm.warp(block.timestamp + rewardsDuration);

        // Double the amount of rewards that should be distributed
        uint256 doubleRewards = unionPirexStrategy.earned();

        assertTrue(doubleRewards > singleRewards);
        assertEq(singleRewards * 2, doubleRewards);
    }

    /**
        @notice Test tx reversion if no new rewards were transferred before period finishes
     */
    function testCannotNotifyRewardAmountNoRewardsBeforePeriodFinish()
        external
    {
        unionPirexStrategy.notifyRewardAmount();
        vm.warp(block.timestamp + 1);
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test tx reversion if no new rewards were transferred after period finishes
     */
    function testCannotNotifyRewardAmountAfterPeriodFinish() external {
        unionPirexStrategy.notifyRewardAmount();
        vm.warp(block.timestamp + rewardsDuration);
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test notifyRewardAmount multiple times before the reward period finishes
        @param  newRewards  uint80  Amount of additional rewards and distribute
     */
    function testNotifyRewardAmountBeforePeriodFinish(uint80 newRewards)
        external
    {
        vm.assume(newRewards > rewardsDuration);

        unionPirexStrategy.notifyRewardAmount();

        // Warp forward halfway before period finishes and transfer in new rewards
        vm.warp(block.timestamp + rewardsDuration / 2);

        // Amount of rewards distributed before the period finish
        uint256 originalRewardsDistributed = unionPirexStrategy.earned();

        _mintAndDepositCVX(newRewards, address(this), false, true);
        pxCvx.transfer(address(unionPirexStrategy), newRewards);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward an entire rewards duration so that all rewards are distributed
        vm.warp(block.timestamp + rewardsDuration);

        // Calculate new rewards dist, taking into account solidity's rounding down ops
        uint256 newRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 newRewardsDistributed = newRewardRate * rewardsDuration;

        // Check that the total earned after the reward period finish is what's expected
        assertEq(
            unionPirexStrategy.earned(),
            newRewardsDistributed + originalRewardsDistributed
        );

        // Confirm that calling `notifyRewardAmount` again w/o new rewards would revert
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test notifyRewardAmount multiple times before the reward period finishes
        @param  newRewards  uint80  Amount of additional rewards and distribute
     */
    function testNotifyRewardAmountAfterPeriodFinish(uint80 newRewards)
        external
    {
        vm.assume(newRewards > rewardsDuration);

        unionPirexStrategy.notifyRewardAmount();

        // Warp forward to reward period finish and transfer in new rewards
        vm.warp(block.timestamp + rewardsDuration);

        // Calculate the expected amount of rewards to be distributed
        uint256 originalRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 originalRewardsDistributed = originalRewardRate *
            rewardsDuration;
        uint256 originalEarned = unionPirexStrategy.earned();

        _mintAndDepositCVX(newRewards, address(this), false, true);
        pxCvx.transfer(address(unionPirexStrategy), newRewards);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward to new reward period finish so that all rewards are distributed
        vm.warp(block.timestamp + rewardsDuration);

        uint256 newRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 newRewardsDistributed = newRewardRate * rewardsDuration;
        uint256 newEarned = unionPirexStrategy.earned();

        // Check that the total earned after the reward period finish is what's expected
        assertEq(
            unionPirexStrategy.earned(),
            newRewardsDistributed + originalRewardsDistributed
        );

        // Confirm that calling `notifyRewardAmount` again w/o new rewards would revert
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }
}
