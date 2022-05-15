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

    /**
        @notice Mint and deposit CVX into the vault before every test
     */
    function setUp() external {
        // Deposit CVX to seed vault with a non-zero totalSupply and balance
        _mintAndDepositCVX(seedAmount, address(this), true, true);
    }

    /**
        @notice Mint and transfer pxCVX to the strategy contract
     */
    function _mintAndTransferRewards(uint256 amount) internal {
        // Deposit CVX and mint pxCVX which will be deposited as rewards
        _mintAndDepositCVX(amount, address(this), false, true);

        // Transfer pxCVX to strategy contract and notify rewards
        pxCvx.transfer(address(unionPirexStrategy), amount);
    }

    /**
        @notice Reproduce the issue of notifyRewardAmount distributing non-existent rewards
                Problem: When there are no new rewards, it will distribute its pxCVX balance
     */
    function testNotifyRewardAmountProblematic() external {
        _mintAndTransferRewards(seedAmount);
        unionPirexStrategy.notifyRewardAmountProblematic();

        // Warp forward to ensure full amount is reflected when calling `earned`
        vm.warp(block.timestamp + rewardsDuration);

        // Total amount of rewards meant to be distributed after a rewardsDuration (14 days)
        uint256 singleRewards = unionPirexStrategy.earned();

        // Call `notifyRewardAmount` again to verify rewards increases w/o additional rewards
        unionPirexStrategy.notifyRewardAmountProblematic();

        // Warp forward to ensure full amount is reflected when calling `earned`
        vm.warp(block.timestamp + rewardsDuration);

        // Double the amount of rewards that should be distributed
        uint256 doubleRewards = unionPirexStrategy.earned();

        assertTrue(doubleRewards > singleRewards);
        assertEq(singleRewards * 2, doubleRewards);
    }

    /**
        @notice Test tx reversion if no new rewards were transferred after period finishes
     */
    function testCannotNotifyRewardAmountAfterPeriodFinish() external {
        _mintAndTransferRewards(seedAmount);
        unionPirexStrategy.notifyRewardAmount();
        vm.warp(block.timestamp + rewardsDuration);
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test tx reversion if reward amount is less than rewardsDuration
     */
    function testCannotNotifyRewardAmountLessThanRewardsDuration() external {
        // If the rewards are less than `rewardsDuration` then the rate will be zero
        // This is due to Solidity rounding down fractions by default
        _mintAndTransferRewards(rewardsDuration - 1);
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test notifyRewardAmount multiple times before the reward period finishes
        @param  newRewards  uint88  Amount of additional rewards to distribute
     */
    function testNotifyRewardAmountBeforePeriodFinish(uint88 newRewards)
        external
    {
        vm.assume(newRewards > rewardsDuration);
        _mintAndTransferRewards(seedAmount);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward halfway before period finishes and transfer in new rewards
        vm.warp(block.timestamp + rewardsDuration / 2);

        // Amount of rewards distributed before the period finish
        uint256 originalRewardsDistributed = unionPirexStrategy.earned();

        _mintAndTransferRewards(newRewards);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward an entire rewards duration so that all rewards are distributed
        vm.warp(block.timestamp + rewardsDuration);

        // Calculate new rewards dist, taking into account solidity's rounding down ops
        uint256 newRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 newRewardsDistributed = newRewardRate * rewardsDuration;
        uint256 earned = unionPirexStrategy.earned();

        // Check that the total earned after the reward period finish is what's expected
        assertEq(earned, newRewardsDistributed + originalRewardsDistributed);

        // Claim rewards to test whether the distribution affects user principal
        unionPirex.harvest();

        // Check that the remaining balance is the sum of rewards and principal sans earned
        assertEq(
            pxCvx.balanceOf(address(unionPirexStrategy)),
            seedAmount + newRewards + unionPirexStrategy.totalSupply() - earned
        );

        // Confirm that calling `notifyRewardAmount` again w/o new rewards would revert
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }

    /**
        @notice Test notifyRewardAmount multiple times after the reward period finishes
        @param  newRewards  uint88  Amount of additional rewards to distribute
     */
    function testNotifyRewardAmountAfterPeriodFinish(uint88 newRewards)
        external
    {
        vm.assume(newRewards > rewardsDuration);
        _mintAndTransferRewards(seedAmount);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward to reward period finish and transfer in new rewards
        vm.warp(block.timestamp + rewardsDuration);

        // Calculate the expected amount of rewards to be distributed
        uint256 originalRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 originalRewardsDistributed = originalRewardRate *
            rewardsDuration;

        _mintAndTransferRewards(newRewards);
        unionPirexStrategy.notifyRewardAmount();

        // Warp forward to new reward period finish so that all rewards are distributed
        vm.warp(block.timestamp + rewardsDuration);

        uint256 newRewardRate = uint256(
            vm.load(address(unionPirexStrategy), bytes32(uint256(3)))
        );
        uint256 newRewardsDistributed = newRewardRate * rewardsDuration;
        uint256 earned = unionPirexStrategy.earned();

        // Check that the total earned after the reward period finish is what's expected
        assertEq(earned, newRewardsDistributed + originalRewardsDistributed);

        // Claim rewards to test whether the distribution affects user principal
        unionPirex.harvest();

        // Check that the post-reward claimed balance remains in tact
        assertEq(
            pxCvx.balanceOf(address(unionPirexStrategy)),
            seedAmount + newRewards + unionPirexStrategy.totalSupply() - earned
        );

        // Confirm that calling `notifyRewardAmount` again w/o new rewards would revert
        vm.expectRevert(NO_REWARDS_ERROR_MSG);
        unionPirexStrategy.notifyRewardAmount();
    }
}
