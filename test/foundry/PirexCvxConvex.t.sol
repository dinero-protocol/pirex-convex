// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";
import {CvxLockerV2} from "contracts/mocks/CvxLocker.sol";

contract PirexCvxConvexTest is Test, HelperContract {
    /**
        @notice Redeem CVX for the specified account and verify the subsequent balances
        @param  account     address  Account redeeming CVX
        @param  unlockTime  uint256  upCVX token id
     */
    function _redeemCVX(address account, uint256 unlockTime) internal {
        uint256[] memory upCvxIds = new uint256[](1);
        uint256[] memory redeemableAssets = new uint256[](1);

        upCvxIds[0] = unlockTime;

        uint256 upCvxBalanceBefore = upCvx.balanceOf(account, upCvxIds[0]);
        uint256 cvxBalanceBefore = CVX.balanceOf(account);

        redeemableAssets[0] = upCvxBalanceBefore;

        vm.prank(account);
        pirexCvx.redeem(upCvxIds, redeemableAssets, account);

        // upCVX must be zero since we specified the balance when redeeming
        assertEq(upCvx.balanceOf(account, upCvxIds[0]), 0);

        // CVX balance must have increased by the amount of upCVX burned as they are 1 to 1
        assertEq(CVX.balanceOf(account), cvxBalanceBefore + upCvxBalanceBefore);
    }

    /**
        @notice Fuzz to verify only the correct amounts are locked and left unlocked
        @param  assets             uint256  CVX mint and deposit amount
        @param  redemptionAmount   uint256  CVX amount to be redeemed
        @param  pendingLockAmount  uint256  CVX amount deposited but not locked
     */
    function testLock(
        uint256 assets,
        uint256 redemptionAmount,
        uint256 pendingLockAmount
    ) external {
        // Need to ensure assets and redemption amounts are greater than the redemption fee min
        // The issue of errors from rounding down will be addressed in a new PR
        (, , uint32 redemptionMin, ) = pirexCvx.getFees();

        vm.assume(assets < 1000e18);
        vm.assume(assets > uint256(redemptionMin));
        vm.assume(redemptionAmount < assets);
        vm.assume(redemptionAmount > uint256(redemptionMin));
        vm.assume(pendingLockAmount != 0);
        vm.assume(pendingLockAmount < 1000e18);

        uint256 tLen = secondaryAccounts.length;

        // Warp to the next epoch
        vm.warp(pxCvx.getCurrentEpoch() + EPOCH_DURATION);

        for (uint256 i; i < tLen; ++i) {
            address secondaryAccount = secondaryAccounts[i];

            // Deposit and lock CVX so that there are locked balances to redeem against
            _mintAndDepositCVX(assets, secondaryAccount, false, true);

            uint256[] memory lockIndexes = new uint256[](1);
            uint256[] memory lockableAssets = new uint256[](1);

            lockIndexes[0] = i;
            lockableAssets[0] = redemptionAmount;

            vm.prank(secondaryAccount);
            pirexCvx.initiateRedemptions(
                lockIndexes,
                PirexCvx.Futures.Reward,
                lockableAssets,
                secondaryAccount
            );

            // Warp forward an epoch to lock and initiate redemptions in different timestamps/lock indexes
            vm.warp(block.timestamp + EPOCH_DURATION * (i + 1));
        }

        (, , , CvxLockerV2.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        uint256 lockLen = lockData.length;

        // The minimum amount of CVX that must remain unlocked (excluding pending locks) to fulfill redemptions
        // Different from `outstandingRedemptions` which is the maximum amount
        uint256 minimumCvxBalanceRequired;

        // Check that `_lock` handles pendingLocks and outstandingRedemptions
        for (uint256 i; i < lockLen; ++i) {
            // Warp to the unlock timestamp to test that the necessary balances are locked and/or unlocked
            vm.warp(lockData[i].unlockTime);

            address secondaryAccount = secondaryAccounts[i];
            (, uint256 unlockable, , ) = CVX_LOCKER.lockedBalances(
                address(pirexCvx)
            );

            // Increment by the user's upCVX balance to track the amount of CVX that must be present in the contract
            minimumCvxBalanceRequired += upCvx.balanceOf(
                secondaryAccount,
                lockData[i].unlockTime
            );

            // Deposit CVX without immediately locking to ensure `pendingLocks` is non-zero for test
            _mintAndDepositCVX(
                pendingLockAmount,
                PRIMARY_ACCOUNT,
                false,
                false
            );

            uint256 pendingLocks = pirexCvx.getPendingLocks();
            uint256 outstandingRedemptions = pirexCvx
                .getOutstandingRedemptions();

            // Maximum amount of CVX that PirexCvx can have (balance and unlockable CVX deducted by pendingLocks)
            uint256 maxCvxBalance = CVX.balanceOf(address(pirexCvx)) +
                unlockable -
                pendingLocks;

            // Actual amount of CVX that PirexCvx should have (anything above outstandingRedemptions is locked)
            uint256 expectedCvxBalance = outstandingRedemptions > maxCvxBalance
                ? maxCvxBalance
                : outstandingRedemptions;
            uint256 lockedBefore = CVX_LOCKER.lockedBalanceOf(
                address(pirexCvx)
            );

            // Lock pendingLocks amount and any amount over outstandingRedemptions
            pirexCvx.lock();

            uint256 lockedAfter = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));
            uint256 postLockCvxBalance = CVX.balanceOf(address(pirexCvx));

            // The post-lock balance must equal expected (i.e. always lock pendingLocks and amounts over outstanding)
            assertEq(postLockCvxBalance, expectedCvxBalance);

            // After accounting for unlocked amounts, the locked balance delta must be GTE to pendingLocks
            assertGe(lockedAfter, (lockedBefore - unlockable) + pendingLocks);

            // The expected (i.e. post-lock) balance must be GTE to the minimum required
            assertGe(expectedCvxBalance, minimumCvxBalanceRequired);

            // The post-lock balance must be LTE to what's necessary to fulfill redemptions
            assertLe(postLockCvxBalance, outstandingRedemptions);
        }

        // After checking that the appropriate amounts are locked or kept unlocked, verify that the CVX is redeemable
        for (uint256 i; i < lockLen; ++i) {
            _redeemCVX(secondaryAccounts[i], lockData[i].unlockTime);
        }
    }
}
