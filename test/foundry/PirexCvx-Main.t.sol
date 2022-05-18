// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/tokens/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";
import {ICvxLocker} from "contracts/interfaces/ICvxLocker.sol";

contract PirexCvxMainTest is Test, HelperContract {
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

    function _validateFutureNotesBalances(
        uint256 fVal,
        uint256 rounds,
        address account,
        uint256 amount
    ) internal {
        uint256 startingEpoch = pirexCvx.getCurrentEpoch() + EPOCH_DURATION;
        ERC1155PresetMinterSupply fToken = (
            PirexCvx.Futures(fVal) == PirexCvx.Futures.Reward ? rpCvx : vpCvx
        );

        for (uint256 i; i < rounds; ++i) {
            assertEq(
                fToken.balanceOf(account, startingEpoch + i * EPOCH_DURATION),
                amount
            );
        }
    }

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

        pirexCvx.deposit(0, address(this), false);
    }

    /**
        @notice Test tx reversion if zero address is the recipient
     */
    function testCannotDepositZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.deposit(1, address(0), false);
    }

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotDepositPaused() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.deposit(1, address(this), false);
    }

    /**
        @notice Test tx reversion on insufficient asset balance
     */
    function testCannotDepositInsufficientBalance() external {
        vm.expectRevert("TRANSFER_FROM_FAILED");

        pirexCvx.deposit(1, secondaryAccounts[0], false);
    }

    /**
        @notice Test deposit without lock
        @param  amount  uint72  Amount of assets for deposit
     */
    function testDepositNoLock(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            _mintAndDepositCVX(amount, account, false, false);

            // Check the PxCvx balance of the account
            assertEq(pxCvx.balanceOf(account), amount);
            assertEq(CVX.balanceOf(account), 0);
        }

        uint256 totalAssets = tLen * amount;
        uint256 locked = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));

        // Check amount of pending locks
        assertEq(pirexCvx.pendingLocks(), totalAssets);
        assertEq(pxCvx.totalSupply(), totalAssets);
        assertEq(locked, 0);
    }

    /**
        @notice Test deposit and immediate lock without compounding
        @param  amount  uint72  Amount of assets for deposit
     */
    function testDeposit(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            _mintAndDepositCVX(amount, account, false, true);

            // Check the PxCvx balance of the account
            assertEq(pxCvx.balanceOf(account), amount);
            assertEq(CVX.balanceOf(account), 0);
        }

        uint256 totalAssets = tLen * amount;
        uint256 locked = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));

        assertEq(pxCvx.totalSupply(), totalAssets);
        assertEq(locked, totalAssets);
    }

    /**
        @notice Test deposit and immediate lock with compounding
        @param  amount  uint72  Amount of assets for deposit
     */
    function testDepositWithCompound(uint72 amount) external {
        vm.assume(amount != 0);

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            _mintAndDepositCVX(amount, account, true, true);

            // Check the balance of the account in the UnionVault
            assertEq(unionPirex.balanceOf(account), amount);
            assertEq(CVX.balanceOf(account), 0);
        }

        uint256 totalAssets = tLen * amount;
        uint256 locked = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));

        // For compounding deposit, the PxCvx tokens are transferred to the Strategy contract
        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), totalAssets);
        assertEq(pxCvx.totalSupply(), totalAssets);
        assertEq(locked, totalAssets);
        assertEq(unionPirex.totalAssets(), totalAssets);
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
        (, , , ICvxLocker.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = lockData.length;
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
        (, , , ICvxLocker.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](2);
        locks[0] = lockData.length;
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
        _mintAndDepositCVX(1e18, address(this), false, true);

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

        _mintAndDepositCVX(1e18, account, false, true);

        (
            ,
            ,
            uint256 locked,
            ICvxLocker.LockedBalance[] memory lockData
        ) = CVX_LOCKER.lockedBalances(address(pirexCvx));

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
        @notice Test initiating redemption
        @param  amount  uint72   Amount of assets for deposit
        @param  fVal    uint256  Integer representation of the futures enum
     */
    function testInitiateRedemptions(uint72 amount, uint256 fVal) external {
        // TMP: Should be !=0 after the fee calculation fixes
        vm.assume(amount > 1000);
        vm.assume(fVal <= uint256(type(PirexCvx.Futures).max));

        address account = secondaryAccounts[0];

        _mintAndDepositCVX(amount, account, false, true);

        (, , , ICvxLocker.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));

        uint256[] memory locks = new uint256[](1);
        uint256[] memory assets = new uint256[](1);
        locks[0] = lockData.length - 1;
        assets[0] = amount;

        uint256 unlockTime = lockData[lockData.length - 1].unlockTime;
        uint256 oldOutstandingRedemptions = pirexCvx.outstandingRedemptions();
        uint256 oldTreasuryBalance = pxCvx.balanceOf(address(pirexFees.treasury()));
        uint256 oldContributorsBalance = pxCvx.balanceOf(address(pirexFees.contributors()));

        vm.prank(account);

        pirexCvx.initiateRedemptions(
            locks,
            PirexCvx.Futures(fVal),
            assets,
            account
        );

        // Simulate the fee calculation separately to avoid "stack too deep" issue
        (uint256 postFeeAmount, uint256 rounds) = _processRedemption(
            unlockTime,
            amount
        );

        assertEq(
            pirexCvx.outstandingRedemptions(),
            oldOutstandingRedemptions + postFeeAmount
        );
        assertEq(pxCvx.balanceOf(account), 0);
        assertEq(upCvx.balanceOf(account, unlockTime), postFeeAmount);

        // Check through all the future notes balances separately to avoid "stack too deep" issue
        _validateFutureNotesBalances(fVal, rounds, account, amount);

        // Check fee distributions separately to avoid "stack too deep" issue
        _validateFeeDistributions(
            oldTreasuryBalance,
            oldContributorsBalance,
            amount - postFeeAmount
        );
    }
}
