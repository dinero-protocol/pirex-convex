// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {HelperContract} from "./HelperContract.sol";
import {CvxLockerV2} from "contracts/mocks/CvxLocker.sol";

contract PirexCvxMainTest is Test, HelperContract {
    /**
        @notice Process and calculate data related to redemptions
        @param  unlockTime  uint256  Unlock time
        @param  amount      uint256  Amount of assets for redemption
     */
    function _processRedemption(uint256 unlockTime, uint256 amount)
        internal
        view
        returns (uint256 postFeeAmount, uint256 rounds)
    {
        uint256 waitTime = (unlockTime - block.timestamp);
        uint256 feeDenom = pirexCvx.FEE_DENOMINATOR();
        uint256 feeMin = pirexCvx.fees(PirexCvx.Fees.RedemptionMin);
        uint256 feeMax = pirexCvx.fees(PirexCvx.Fees.RedemptionMax);
        uint256 feePercent = feeMax -
            (((feeMax - feeMin) * waitTime) / pirexCvx.MAX_REDEMPTION_TIME());

        postFeeAmount = amount - ((amount * feePercent) / feeDenom);
        rounds = waitTime / EPOCH_DURATION;

        if (
            rounds == 0 &&
            unlockTime % EPOCH_DURATION != 0 &&
            waitTime > (EPOCH_DURATION / 2)
        ) {
            unchecked {
                ++rounds;
            }
        }
    }

    /**
        @notice Validate the results of distributing fees
        @param  oldTreasuryBalance      uint256  Previous PxCvx balance for treasury
        @param  oldContributorsBalance  uint256  Previous PxCvx balance for contributors
        @param  fee                     uint256  Amount of fee
     */
    function _validateFeeDistributions(
        uint256 oldTreasuryBalance,
        uint256 oldContributorsBalance,
        uint256 fee
    ) internal {
        uint256 treasuryFees = (fee * pirexFees.treasuryPercent()) /
            pirexFees.PERCENT_DENOMINATOR();
        uint256 contributorsFees = (fee - treasuryFees);

        assertEq(
            pxCvx.balanceOf(address(pirexFees.treasury())),
            oldTreasuryBalance + treasuryFees
        );
        assertEq(
            pxCvx.balanceOf(address(pirexFees.contributors())),
            oldContributorsBalance + contributorsFees
        );
    }

    /*//////////////////////////////////////////////////////////////
                        deposit TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion on deposit with 0 amount
     */
    function testCannotDepositZeroAmount() external {
        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.deposit(0, address(this), false, address(0));
    }

    /**
        @notice Test tx reversion if zero address is the recipient
     */
    function testCannotDepositZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.deposit(1, address(0), false, address(0));
    }

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotDepositPaused() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.deposit(1, address(this), false, address(0));
    }

    /**
        @notice Test tx reversion on insufficient asset balance
     */
    function testCannotDepositInsufficientBalance() external {
        vm.expectRevert("TRANSFER_FROM_FAILED");

        pirexCvx.deposit(1, secondaryAccounts[0], false, address(0));
    }

    /**
        @notice Test deposit without lock
        @param  amount  uint72  Amount of assets for deposit
     */
    function testDepositNoLock(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 totalAssets;
        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];
            uint256 asset = amount * (i + 1);

            totalAssets += asset;

            _mintAndDepositCVX(asset, account, false, address(0), false);

            // Check the PxCvx balance of the account
            assertEq(pxCvx.balanceOf(account), asset);
            assertEq(CVX.balanceOf(account), 0);
        }

        uint256 locked = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));

        // Check amount of pending locks
        assertEq(pirexCvx.pendingLocks(), totalAssets);
        assertEq(pxCvx.totalSupply(), totalAssets);
        assertEq(locked, 0);
    }

    /**
        @notice Test deposit and immediate lock with compounding
        @param  amount  uint72  Amount of assets for deposit
     */
    function testDepositWithCompound(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 totalAssets;
        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];
            uint256 asset = amount * (i + 1);

            totalAssets += asset;

            _mintAndDepositCVX(asset, account, true, address(0), true);

            // Check the balance of the account in the UnionVault
            assertEq(unionPirex.balanceOf(account), asset);
            assertEq(CVX.balanceOf(account), 0);
        }

        uint256 locked = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));

        // For compounding deposit, the PxCvx tokens are transferred to the Strategy contract
        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), totalAssets);
        assertEq(pxCvx.totalSupply(), totalAssets);
        assertEq(locked, totalAssets);
        assertEq(unionPirex.totalAssets(), totalAssets);
    }

    /**
        @notice Fuzz test deposit
     */
    function testDeposit(
        uint256 assets,
        uint32 fee,
        bool shouldCompound,
        bool shouldLock,
        bool shouldAddDeveloper
    ) external {
        vm.assume(assets != 0);
        vm.assume(assets < 100e18);
        vm.assume(fee < pirexCvx.FEE_MAX());

        address receiver = address(this);
        address developer = PRIMARY_ACCOUNT;

        // Add developer to whitelist (WL)
        if (shouldAddDeveloper) {
            pirexCvx.addDeveloper(developer);
        }

        // Set fee even if the developer is not on WL, to test whether they receive incentives
        pirexCvx.setFee(PirexCvx.Fees.Developers, fee);

        // Developer assertions
        assertEq(pirexCvx.developers(developer), shouldAddDeveloper);
        assertEq(pirexCvx.fees(PirexCvx.Fees.Developers), fee);

        _mintCvx(address(this), assets);
        CVX.approve(address(pirexCvx), assets);
        pirexCvx.deposit(assets, receiver, shouldCompound, developer);

        if (shouldLock) {
            pirexCvx.lock();
        }

        uint256 feeAmount = shouldAddDeveloper
            ? (assets * fee) / pirexCvx.FEE_DENOMINATOR()
            : 0;
        uint256 receivedAmount = assets - feeAmount;

        // Balance assertions based on whether shouldCompound is true
        assertEq(
            pxCvx.balanceOf(address(unionPirexStrategy)),
            shouldCompound ? receivedAmount : 0
        );
        assertEq(
            unionPirex.balanceOf(receiver),
            shouldCompound ? receivedAmount : 0
        );
        assertEq(
            pxCvx.balanceOf(address(this)),
            shouldCompound ? 0 : receivedAmount
        );
        assertEq(
            unionPirex.balanceOf(address(this)),
            shouldCompound ? receivedAmount : 0
        );

        // Balance assertions based on whether CVX is locked
        assertEq(CVX.balanceOf(address(pirexCvx)), shouldLock ? 0 : assets);
        assertEq(
            CVX_LOCKER.lockedBalanceOf(address(pirexCvx)),
            shouldLock ? assets : 0
        );

        // Balance assertions based on whether developer should receive incentives
        assertEq(
            pxCvx.balanceOf(developer),
            shouldAddDeveloper ? feeAmount : 0
        );
    }

    /*//////////////////////////////////////////////////////////////
                        initiateRedemptions TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if initiating redemption with empty lock array
     */
    function testCannotInitiateRedemptionsEmptyArray() external {
        uint256[] memory locks = new uint256[](0);
        uint256[] memory assets = new uint256[](1);
        assets[0] = 1;

        vm.expectRevert(PirexCvx.EmptyArray.selector);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if initiating redemption with invalid lock array
     */
    function testCannotInitiateRedemptionsInvalidLock() external {
        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = 1;
        assets[0] = 1;

        vm.expectRevert(stdError.indexOOBError);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if initiating redemption with mismatched arguments length
     */
    function testCannotInitiateRedemptionsMismatchedArrayLengths() external {
        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](2);
        locks[0] = 0;
        assets[0] = 1;
        assets[1] = 1;

        vm.expectRevert(PirexCvx.MismatchedArrayLengths.selector);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if initiating redemption with zero asset
     */
    function testCannotInitiateRedemptionsZeroAmount() external {
        _mintAndDepositCVX(1e18, address(this), false, address(0), true);

        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = 0;
        assets[0] = 0;

        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if initiating redemption for zero address as recipient
     */
    function testCannotInitiateRedemptionsZeroAddress() external {
        _mintAndDepositCVX(1e18, address(this), false, address(0), true);

        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = 0;
        assets[0] = 1;

        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(0)
        );
    }

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotInitiateRedemptionsPaused() external {
        pirexCvx.setPauseState(true);

        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = 0;
        assets[0] = 0;

        vm.expectRevert("Pausable: paused");

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if initiating redemption with insufficient asset
     */
    function testCannotInitiateRedemptionsInsufficientRedemptionAllowance()
        external
    {
        address account = secondaryAccounts[0];

        _mintAndDepositCVX(1e18, account, false, address(0), true);

        (, , , CvxLockerV2.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = 0;
        assets[0] = lockData[0].amount * 100;

        vm.expectRevert(PirexCvx.InsufficientRedemptionAllowance.selector);
        vm.prank(account);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures.Reward,
            assets,
            account
        );
    }

    /**
        @notice Test that the tx reverts if redemptionMax is zero with faulty method.
                In addition to the `ZeroAmount` error, it was previously possible for
                redemptionMax to be set below redemptionMin, causing an underflow error -
                with the latest set of fixes, that is no longer possible.         
     */
    function testCannotInitiateRedemptionsFaultyZeroRedemptionMax() external {
        _resetFees();

        (
            ,
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setupRedemption(address(this), 1e18, 0, false);

        vm.expectRevert(PxCvx.ZeroAmount.selector);

        pirexCvx.initiateRedemptionsFaulty(
            lockIndexes,
            PirexCvx.Futures.Reward,
            redemptionAssets,
            address(this)
        );
    }

    /**
        @notice Test initiating redemptions with zero redemption max fees (patched method)
                It's assumed (asserted below) that redemptionMin is zero, as redemptionMax
                cannot be less than it (check in `setFee`)
     */
    function testInitiateRedemptionsForZeroRedemptionMax() external {
        _resetFees();

        (
            ,
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setupRedemption(address(this), 1e18, 0, false);
        (, uint32 redemptionMax, uint32 redemptionMin, ) = pirexCvx.getFees();

        assertEq(redemptionMax, 0);
        assertEq(redemptionMin, 0);

        pirexCvx.initiateRedemptions(
            lockIndexes,
            PirexCvx.Futures.Reward,
            redemptionAssets,
            address(this)
        );
    }

    /**
        @notice Test initiating redemptions with redemption max set to FEE_MAX
     */
    function testInitiateRedemptionsForMaxRedemptionMax() external {
        _resetFees();
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, FEE_MAX);

        (
            ,
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setupRedemption(address(this), 1e18, 0, false);
        (, uint32 redemptionMax, , ) = pirexCvx.getFees();

        assertEq(redemptionMax, FEE_MAX);

        pirexCvx.initiateRedemptions(
            lockIndexes,
            PirexCvx.Futures.Reward,
            redemptionAssets,
            address(this)
        );
    }

    /**
        @notice Test initiating redemptions with equal redemption fees
        @param  redemptionFee  uint32  Redemption max and min fees
     */
    function testInitiateRedemptionsForEqualRedemptionFees(uint32 redemptionFee)
        external
    {
        vm.assume(redemptionFee < FEE_MAX);

        _resetFees();
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionFee);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionFee);

        (
            ,
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setupRedemption(address(this), 1e18, 0, false);
        (, uint32 redemptionMax, uint32 redemptionMin, ) = pirexCvx.getFees();

        assertEq(redemptionMax, redemptionMin);

        pirexCvx.initiateRedemptions(
            lockIndexes,
            PirexCvx.Futures.Reward,
            redemptionAssets,
            address(this)
        );
    }

    /**
        @notice Test initiating redemption with various fees settings
        @param  amount             uint72  Amount of assets for redemption
        @param  fVal               uint8   Integer representation of the futures enum
        @param  redemptionMaxFee   uint32  Redemption max fee
        @param  redemptionMinFee   uint32  Redemption min fee
     */
    function testInitiateRedemptions(
        uint72 amount,
        uint8 fVal,
        uint32 redemptionMaxFee,
        uint32 redemptionMinFee
    ) external {
        vm.assume(amount != 0);
        vm.assume(fVal <= uint8(type(PirexCvx.Futures).max));
        vm.assume(redemptionMaxFee < FEE_MAX);
        vm.assume(redemptionMinFee < FEE_MAX);
        vm.assume(redemptionMaxFee > redemptionMinFee);

        _resetFees();
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMaxFee);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMinFee);

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];
            uint256 asset = amount * (i + 1);
            uint256 oldOutstandingRedemptions = pirexCvx
                .outstandingRedemptions();
            uint256 oldTreasuryBalance = pxCvx.balanceOf(
                address(pirexFees.treasury())
            );
            uint256 oldContributorsBalance = pxCvx.balanceOf(
                address(pirexFees.contributors())
            );

            (uint256 unlockTime, , ) = _setupRedemption(
                account,
                asset,
                fVal,
                true
            );

            // Simulate the fee calculation separately to avoid "stack too deep" issue
            (uint256 postFeeAmount, uint256 rounds) = _processRedemption(
                unlockTime,
                asset
            );

            assertEq(
                pirexCvx.outstandingRedemptions(),
                oldOutstandingRedemptions + postFeeAmount
            );
            assertEq(pxCvx.balanceOf(account), 0);
            assertEq(upxCvx.balanceOf(account, unlockTime), postFeeAmount);

            // Check through all the future notes balances separately to avoid "stack too deep" issue
            _validateFutureNotesBalances(fVal, rounds, account, asset);

            // Check fee distributions separately to avoid "stack too deep" issue
            _validateFeeDistributions(
                oldTreasuryBalance,
                oldContributorsBalance,
                asset - postFeeAmount
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                        redeem TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotRedeemPaused() external {
        pirexCvx.setPauseState(true);

        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        unlockTimes[0] = 0;
        assets[0] = 0;

        vm.expectRevert("Pausable: paused");

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test tx reversion if redeeming with empty lock array
     */
    function testCannotRedeemEmptyArray() external {
        uint256[] memory unlockTimes = new uint256[](0);
        uint256[] memory assets = new uint256[](1);
        assets[0] = 1;

        vm.expectRevert(PirexCvx.EmptyArray.selector);

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test tx reversion if redeeming with mismatched arguments length
     */
    function testCannotRedeemMismatchedArrayLengths() external {
        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](2);
        unlockTimes[0] = 0;
        assets[0] = 1;
        assets[1] = 1;

        vm.expectRevert(PirexCvx.MismatchedArrayLengths.selector);

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test tx reversion if redeeming for zero address as recipient
     */
    function testCannotRedeemZeroAddress() external {
        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        unlockTimes[0] = 0;
        assets[0] = 1;

        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.redeem(unlockTimes, assets, address(0));
    }

    /**
        @notice Test tx reversion if redeeming before unlock
     */
    function testCannotRedeemBeforeUnlock() external {
        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        unlockTimes[0] = block.timestamp + 1 days;
        assets[0] = 1;

        vm.expectRevert(PirexCvx.BeforeUnlock.selector);

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test tx reversion if redeeming with zero amount
     */
    function testCannotRedeemZeroAmount() external {
        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        unlockTimes[0] = 0;
        assets[0] = 0;

        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test tx reversion if redeeming with insufficient asset
     */
    function testCannotRedeemInsufficientAssets() external {
        uint256[] memory unlockTimes = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        unlockTimes[0] = 0;
        assets[0] = 1;

        vm.expectRevert(stdError.arithmeticError);

        pirexCvx.redeem(unlockTimes, assets, address(this));
    }

    /**
        @notice Test redeeming
        @param  amount  uint72   Amount of assets for redeeming
     */
    function testRedeem(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];
            uint256 asset = amount * (i + 1);

            // Simulate redemption and calculate unlock time as well as the actual amount after fee
            (uint256 unlockTime, , ) = _setupRedemption(
                account,
                asset,
                0,
                true
            );

            uint256 oldOutstandingRedemptions = pirexCvx
                .outstandingRedemptions();
            uint256 oldCvxBalance = CVX.balanceOf(account);
            uint256 oldUpxCvxBalance = upxCvx.balanceOf(account, unlockTime);

            (uint256 postFeeAmount, ) = _processRedemption(unlockTime, asset);

            // Time-skip until the designated unlock time
            vm.warp(unlockTime);

            uint256[] memory unlockTimes = new uint256[](1);
            uint256[] memory assets = new uint256[](1);
            unlockTimes[0] = unlockTime;
            assets[0] = postFeeAmount;

            vm.prank(account);

            pirexCvx.redeem(unlockTimes, assets, account);

            assertEq(CVX.balanceOf(account), oldCvxBalance + postFeeAmount);
            assertEq(
                upxCvx.balanceOf(account, unlockTime),
                oldUpxCvxBalance - postFeeAmount
            );
            assertEq(
                pirexCvx.outstandingRedemptions(),
                oldOutstandingRedemptions - postFeeAmount
            );
        }
    }
}
