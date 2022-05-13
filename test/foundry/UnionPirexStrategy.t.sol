// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {HelperContract} from "./HelperContract.sol";

contract UnionPirexStrategy is Test, HelperContract {
    /**
        @notice Reproduce the potential issue of notifyRewardAmount issuing invalid rewards
     */
    function testNotifyRewardAmountProblematic() external {
        // Deposit CVX to seed vault with a non-zero totalSupply and balance
        _mintAndDepositCVX(1e18, address(this), true, true);

        // Deposit CVX and mint pxCVX which will be deposited as rewards
        _mintAndDepositCVX(1e18, address(this), false, true);

        // Transfer pxCVX to strategy contract and notify rewards
        pxCvx.transfer(address(unionPirexStrategy), 1e18);
        unionPirexStrategy.notifyRewardAmountProblematic();

        uint256 rewardsDuration = unionPirexStrategy.getRewardsDuration();

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
}
