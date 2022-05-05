// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";
import {ICvxLocker} from "contracts/interfaces/ICvxLocker.sol";

contract PirexCvxConvexTest is Test, HelperContract {
    ERC20 private CVX;
    ICvxLocker private immutable cvxLockerContract;
    PxCvx private immutable pxCvx;
    ERC1155Solmate private immutable upCvx;
    PirexCvxMock private immutable pirexCvx;

    address private constant PRIMARY_ACCOUNT =
        0x5409ED021D9299bf6814279A6A1411A7e866A631;
    address[3] private testers = [
        0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb,
        0xE36Ea790bc9d7AB70C55260C66D52b1eca985f84,
        0xE834EC434DABA538cd1b9Fe1582052B880BD7e63
    ];
    uint256 private constant EPOCH_DURATION = 1209600;

    constructor() {
        CVX = ERC20(cvx);
        cvxLockerContract = ICvxLocker(cvxLocker);
        (pxCvx, , upCvx, , , pirexCvx) = _deployPirex();
    }

    function _mintAndDepositCVX(
        uint256 assets,
        address receiver,
        bool shouldCompound,
        bool lock
    ) internal {
        _mintCvx(receiver, assets);
        vm.startPrank(receiver);
        CVX.approve(address(pirexCvx), CVX.balanceOf(receiver));
        pirexCvx.deposit(assets, receiver, shouldCompound);

        if (lock) {
            pirexCvx.lock();
        }

        vm.stopPrank();
    }

    /**
        @notice Fuzz to verify only the correct amounts are locked and left unlocked
        @param  assets             uint256  CVX mint and deposit amount
        @param  redemptionAmount   uint256  Initiate redemption amount
        @param  pendingLockAmount  uint256  Deposit without locking amount
     */
    function testLock(
        uint256 assets,
        uint256 redemptionAmount,
        uint256 pendingLockAmount
    ) external {
        // Need to ensure assets and redemption amounts are greater than the redemption fee min
        // The issue of errors from rounding down will be addressed in a new PR
        (, , uint32 redemptionMin) = pirexCvx.getFees();

        vm.assume(assets < 1000e18);
        vm.assume(assets > uint256(redemptionMin));
        vm.assume(redemptionAmount < assets);
        vm.assume(redemptionAmount > uint256(redemptionMin));
        vm.assume(pendingLockAmount != 0);
        vm.assume(pendingLockAmount < 1000e18);

        uint256 tLen = testers.length;

        // Warp to the next epoch
        vm.warp(pxCvx.getCurrentEpoch() + EPOCH_DURATION);

        for (uint256 i; i < tLen; ++i) {
            address tester = testers[i];

            // Deposit CVX so that we have locks to redeem
            _mintAndDepositCVX(assets, tester, false, true);

            uint256[] memory lockIndexes = new uint256[](1);
            uint256[] memory _assets = new uint256[](1);

            lockIndexes[0] = i;
            _assets[0] = redemptionAmount;

            vm.prank(tester);
            pirexCvx.initiateRedemptions(
                lockIndexes,
                PirexCvx.Futures.Reward,
                _assets,
                tester
            );

            // Warp forward to redeem from other lock indexes
            vm.warp(block.timestamp + EPOCH_DURATION * (i + 1));
        }

        (, , , ICvxLocker.LockedBalance[] memory lockData) = cvxLockerContract
            .lockedBalances(address(pirexCvx));
        uint256 lockLen = lockData.length;

        // The minimum amount of CVX that must remain unlocked to fulfill redemptions
        // Different from outstandingRedemptions since it will take into account unlocks
        uint256 minimumCvxBalanceRequired;

        // Check that `_lock` handles pendingLocks and outstandingRedemptions
        for (uint256 i; i < lockLen; ++i) {
            // Warp to the unlock timestamp to test that only the adequate amounts are locked
            vm.warp(lockData[i].unlockTime);

            address tester = testers[i];
            (, uint256 unlockable, , ) = cvxLockerContract.lockedBalances(
                address(pirexCvx)
            );

            // Increment by the user's upCVX balance which should now be redeemable for CVX
            minimumCvxBalanceRequired += upCvx.balanceOf(
                tester,
                lockData[i].unlockTime
            );

            // Deposit CVX without locking to ensure pendingLocks is non-zero
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
            uint256 lockedBefore = cvxLockerContract.lockedBalanceOf(
                address(pirexCvx)
            );

            // Lock pendingLocks amount and any amount over outstandingRedemptions
            pirexCvx.lock();

            uint256 lockedAfter = cvxLockerContract.lockedBalanceOf(
                address(pirexCvx)
            );
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
    }
}
