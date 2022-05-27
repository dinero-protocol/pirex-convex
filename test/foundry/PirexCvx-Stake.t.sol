// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxStakeTest is Test, HelperContract {
    /*//////////////////////////////////////////////////////////////
                        stake TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotStakePaused() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.stake(0, PirexCvx.Futures.Reward, 1, address(this));
    }

    /**
        @notice Test tx reversion if staking with zero round
     */
    function testCannotStakeZeroRound() external {
        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.stake(0, PirexCvx.Futures.Reward, 1, address(this));
    }

    /**
        @notice Test tx reversion if staking with zero amount
     */
    function testCannotStakeZeroAmount() external {
        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.stake(1, PirexCvx.Futures.Reward, 0, address(this));
    }

    /**
        @notice Test tx reversion if staking for zero address
     */
    function testCannotStakeZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.stake(1, PirexCvx.Futures.Reward, 1, address(0));
    }

    /**
        @notice Test staking after redeeming first from UnionVault
        @param  amount        uint72   Amount of assets for staking
        @param  redeemAmount  uint8    Amount of assets to be redeemed back from UnionVault
        @param  rounds        uint8    Number of rounds
        @param  fVal          uint8    Integer representation of the futures enum
     */
    function testStakeAfterCompounding(
        uint72 amount,
        uint8 redeemAmount,
        uint8 rounds,
        uint8 fVal
    ) external {
        vm.assume(amount != 0);
        vm.assume(redeemAmount != 0 && redeemAmount <= amount);
        vm.assume(rounds > 0 && rounds < 50);
        vm.assume(fVal <= uint8(type(PirexCvx.Futures).max));

        address account = address(this);

        _mintAndDepositCVX(amount, account, true, address(0), true);

        // Should revert due to insufficient amount to burn
        // as we haven't redeem back from UnionVault
        vm.expectRevert(stdError.arithmeticError);

        pirexCvx.stake(rounds, PirexCvx.Futures(fVal), amount, account);

        // Redeem back from UnionVault first before staking and confirm the final redeemed amount
        uint256 redeemAfterFee = unionPirex.previewRedeem(redeemAmount);
        unionPirex.redeem(redeemAmount, account, account);

        assertEq(pxCvx.balanceOf(account), redeemAfterFee);

        pirexCvx.stake(rounds, PirexCvx.Futures(fVal), redeemAfterFee, account);

        assertEq(pxCvx.balanceOf(account), 0);
        assertEq(
            spxCvx.balanceOf(
                account,
                pirexCvx.getCurrentEpoch() + EPOCH_DURATION * rounds
            ),
            redeemAfterFee
        );

        _validateFutureNotesBalances(fVal, rounds, account, redeemAfterFee);
    }

    /**
        @notice Test staking
        @param  amount  uint72   Amount of assets for staking
        @param  rounds  uint8    Number of rounds
        @param  fVal    uint8    Integer representation of the futures enum
     */
    function testStake(
        uint72 amount,
        uint8 rounds,
        uint8 fVal
    ) external {
        vm.assume(amount != 0);
        vm.assume(rounds > 0 && rounds < 50);
        vm.assume(fVal <= uint8(type(PirexCvx.Futures).max));

        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            _mintAndDepositCVX(amount, account, false, address(0), true);

            assertEq(pxCvx.balanceOf(account), amount);

            vm.prank(account);

            pirexCvx.stake(rounds, PirexCvx.Futures(fVal), amount, account);

            assertEq(pxCvx.balanceOf(account), 0);
            assertEq(
                spxCvx.balanceOf(
                    account,
                    pirexCvx.getCurrentEpoch() + EPOCH_DURATION * rounds
                ),
                amount
            );

            _validateFutureNotesBalances(fVal, rounds, account, amount);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        unstake TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotUnstakePaused() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.unstake(0, 0, address(this));
    }

    /**
        @notice Test tx reversion if unstaking before expiry
     */
    function testCannotUnstakeBeforeExpiry() external {
        vm.expectRevert(PirexCvx.BeforeStakingExpiry.selector);

        pirexCvx.unstake(block.timestamp + 1 days, 0, address(this));
    }

    /**
        @notice Test tx reversion if unstaking before expiry
     */
    function testCannotUnstakeZeroAmount() external {
        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.unstake(0, 0, address(this));
    }

    /**
        @notice Test tx reversion if unstaking before expiry
     */
    function testCannotUnstakeZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.unstake(0, 1, address(0));
    }

    /**
        @notice Test unstaking
        @param  amount  uint72  Amount of assets to unstake
        @param  rounds  uint8   Number of rounds
     */
    function testUnstake(uint72 amount, uint8 rounds) external {
        vm.assume(amount != 0);
        vm.assume(rounds > 0 && rounds < 50);

        uint256 spxCvxId = pirexCvx.getCurrentEpoch() + EPOCH_DURATION * rounds;
        uint256 tLen = secondaryAccounts.length;

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            _mintAndDepositCVX(amount, account, false, address(0), true);

            // Simulate staking first before unstaking
            vm.prank(account);

            pirexCvx.stake(rounds, PirexCvx.Futures.Reward, amount, account);

            assertEq(pxCvx.balanceOf(account), 0);
            assertEq(spxCvx.balanceOf(account, spxCvxId), amount);
        }

        // Time-skip beyond the expiry
        vm.warp(spxCvxId + EPOCH_DURATION);

        for (uint256 i; i < tLen; ++i) {
            address account = secondaryAccounts[i];

            vm.prank(account);

            pirexCvx.unstake(spxCvxId, amount, account);

            assertEq(pxCvx.balanceOf(account), amount);
            assertEq(spxCvx.balanceOf(account, spxCvxId), 0);
        }
    }
}
