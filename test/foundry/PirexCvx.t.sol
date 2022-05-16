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

contract PirexCvxTest is Test, HelperContract {
    /**
        @notice Stake pxCVX and mint rpCVX based on input parameters
        @param  rounds  uint256  Rounds
        @param  assets  uint256  pxCVX
     */
    function _stakePxCvx(uint256 rounds, uint256 assets) internal {
        vm.prank(PRIMARY_ACCOUNT);
        pirexCvx.stake(
            rounds,
            PirexCvx.Futures.Reward,
            assets,
            PRIMARY_ACCOUNT
        );
    }

    /**
        @notice Transfer rpCVX to other receiver
        @param  receiver  address  rpCVX receiver
        @param  epoch     address  rpCVX id
        @param  amount    uin256   rpCVX amount
     */
    function _transferRpCvx(
        address receiver,
        uint256 epoch,
        uint256 amount
    ) internal {
        vm.prank(PRIMARY_ACCOUNT);
        rpCvx.safeTransferFrom(PRIMARY_ACCOUNT, receiver, epoch, amount, "");
    }

    /**
        @notice Transfer rpCVX to secondary accounts and redeem rewards
        @param  assets                     uint256  Total rpCVX to distribute to secondaryAccounts
        @param  selector                   bytes4   Function select of a redeem futures rewards method
        @return totalRedeemedRewards       uint256  Total amount of rewards that have been redeemed
        @return totalFuturesRewards        uint256  The maximum amount of futures rewards (i.e. 1st element in this test)
        @return totalAttemptedRedemptions  uint256  Total amount of attempted redemptions based on the reward redemption formula
     */
    function _distributeNotesRedeemRewards(uint256 assets, bytes4 selector)
        internal
        returns (
            uint256 totalRedeemedRewards,
            uint256 totalFuturesRewards,
            uint256 totalAttemptedRedemptions
        )
    {
        uint256 tLen = secondaryAccounts.length;
        uint256 epoch = pxCvx.getCurrentEpoch();
        (, , , uint256[] memory allFuturesRewards) = pxCvx.getEpoch(epoch);
        totalFuturesRewards = allFuturesRewards[0];

        for (uint256 i; i < tLen; ++i) {
            (, , , uint256[] memory currentFuturesRewards) = pxCvx.getEpoch(
                epoch
            );

            // Different amounts of rpCVX distributed based on loop index and secondary account ordering
            // If it's the last iteration, transfer the remaining balance to ensure all rewards redeemed
            uint256 transferAmount = (tLen - 1) != i
                ? assets / (tLen - i)
                : rpCvx.balanceOf(PRIMARY_ACCOUNT, epoch);
            address secondaryAccount = secondaryAccounts[i];

            // Cumulative attempted redemptions amounts using the same formula as `redeemFuturesRewards`
            totalAttemptedRedemptions +=
                (currentFuturesRewards[0] * transferAmount) /
                rpCvx.totalSupply(epoch);

            // Transfer rpCVX so that secondaryAccount can redeem futures rewards
            _transferRpCvx(secondaryAccount, epoch, transferAmount);

            // Impersonate secondaryAccount and redeem futures rewards
            vm.startPrank(secondaryAccount);
            rpCvx.setApprovalForAll(address(pirexCvx), true);

            // Call either the patched or bugged redeemFuturesReward method
            // `success` inconsistently returns false for bugged method so is not checked
            address(pirexCvx).call(
                abi.encodeWithSelector(selector, epoch, secondaryAccount)
            );
            vm.stopPrank();

            // Total up redeemed reward amount to confirm whether redemption amount is correct
            totalRedeemedRewards += balanceOf[secondaryAccount];

            // Set secondaryAccount balance to zero so we can easily test future redeemed totals
            balanceOf[secondaryAccount] = 0;
        }
    }

    /**
        @notice Guardrails for our fuzz test inputs
        @param  rounds        uint256  Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint256  Percent of pxCVX to stake (255 is denominator)
     */
    function _redeemFuturesRewardsFuzzParameters(
        uint256 rounds,
        uint256 assets,
        uint256 stakePercent
    ) internal {
        vm.assume(rounds != 0);
        vm.assume(rounds < 10);
        vm.assume(assets != 0);
        vm.assume(assets < 10000e18);
        vm.assume(assets > 1e18);
        vm.assume(stakePercent != 0);
        vm.assume(stakePercent < 255);
    }

    /**
        @notice Fuzz the patched version of redeemFuturesRewards to verify now correctly implemented
        @param  rounds        uint256  Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint256  Percent of pxCVX to stake
     */
    function testRedeemFuturesRewards(
        uint256 rounds,
        uint256 assets,
        uint256 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);
        _stakePxCvx(rounds, stakeAmount);

        // Forward 1 epoch, since rpCVX has claim to rewards in subsequent epochs
        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            _distributeEpochRewards(assets);

            // Distribute rpCVX to secondaryAccounts and redeem their futures rewards
            (
                uint256 totalRedeemedRewards,
                uint256 totalFuturesRewards,
                uint256 totalAttemptedRedemptions
            ) = _distributeNotesRedeemRewards(
                    stakeAmount,
                    pirexCvx.redeemFuturesRewards.selector
                );

            assertEq(totalRedeemedRewards, totalFuturesRewards);
            assertEq(totalAttemptedRedemptions, totalFuturesRewards);

            // Forward to the next block and repeat
            vm.warp(block.timestamp + EPOCH_DURATION);
        }
    }

    /**
        @notice Fuzz the bugged version of redeemFuturesRewards to reproduce find
        @param  rounds        uint256  Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint256  Percent of pxCVX to stake
     */
    function testRedeemFuturesRewardsBugged(
        uint256 rounds,
        uint256 assets,
        uint256 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);
        _stakePxCvx(rounds, stakeAmount);

        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            _distributeEpochRewards(assets);

            (
                ,
                uint256 totalFuturesRewards,
                uint256 totalAttemptedRedemptions
            ) = _distributeNotesRedeemRewards(
                    stakeAmount,
                    pirexCvx.redeemFuturesRewardsBugged.selector
                );

            // This assertion confirms that the calculated redemption amounts are invalid
            // Attempted redemptions should never exceed the futures rewards for an index
            assertGt(totalAttemptedRedemptions, totalFuturesRewards);

            vm.warp(block.timestamp + EPOCH_DURATION);
        }
    }

    /**
        @notice Test tx reversion if epoch is zero
     */
    function testCannotRedeemFuturesRewardsZeroEpoch() external {
        vm.expectRevert(PirexCvx.InvalidEpoch.selector);

        pirexCvx.redeemFuturesRewards(0, PRIMARY_ACCOUNT);
    }

    /**
        @notice Fuzz to verify tx reverts if epoch greater than the current epoch
     */
    function testCannotRedeemFuturesRewardsInvalidEpoch(uint256 epoch)
        external
    {
        vm.assume(epoch > pxCvx.getCurrentEpoch());
        vm.expectRevert(PirexCvx.InvalidEpoch.selector);

        pirexCvx.redeemFuturesRewards(epoch, PRIMARY_ACCOUNT);
    }

    /**
        @notice Fuzz to verify tx reverts if receiver is zero address
        @param  epoch  uint256  Reward epoch
     */
    function testCannotRedeemFuturesRewardsZeroAddress(uint256 epoch) external {
        vm.assume(epoch != 0);
        vm.assume(epoch <= pxCvx.getCurrentEpoch());
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.redeemFuturesRewards(epoch, address(0));
    }

    /**
        @notice Fuzz to verify tx reverts if epoch has no rewards
        @param  epoch  uint256  Reward epoch
     */
    function testCannotRedeemFuturesRewardsNoRewards(uint256 epoch) external {
        vm.assume(epoch != 0);
        vm.assume(epoch <= pxCvx.getCurrentEpoch());
        vm.expectRevert(PirexCvx.NoRewards.selector);

        pirexCvx.redeemFuturesRewards(epoch, PRIMARY_ACCOUNT);
    }

    /**
        @notice Fuzz to verify tx reverts if receiver does not have any rpCVX
        @param  rounds        uint256  Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint256  Percent of pxCVX to stake
     */
    function testCannotRedeemFuturesRewardsInsufficientBalance(
        uint256 rounds,
        uint256 assets,
        uint256 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);
        _stakePxCvx(rounds, stakeAmount);

        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            _distributeEpochRewards(assets);

            uint256 epoch = pxCvx.getCurrentEpoch();
            uint256 tLen = secondaryAccounts.length;

            for (uint256 j; j < tLen; ++j) {
                address secondaryAccount = secondaryAccounts[j];

                vm.expectRevert(PirexCvx.InsufficientBalance.selector);
                vm.prank(secondaryAccount);

                // Attempt redeeming rewards as the secondaryAccount with zero balance
                pirexCvx.redeemFuturesRewards(epoch, secondaryAccount);
            }

            vm.warp(block.timestamp + EPOCH_DURATION);
        }
    }
}
