// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxTest is Test, ERC20("Test", "TEST", 18), HelperContract {
    ERC20 private CVX;
    PxCvx private immutable pxCvx;
    ERC1155Solmate private immutable spCvx;
    ERC1155PresetMinterSupply private immutable rpCvx;
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
        (pxCvx, spCvx, , rpCvx, pirexCvx) = _deployPirex();

        vm.prank(PRIMARY_ACCOUNT);
        CVX.approve(address(pirexCvx), type(uint256).max);
    }

    function _mintAndDepositCVX(uint256 assets, bool shouldCompound) internal {
        _mintCvx(PRIMARY_ACCOUNT, assets);
        vm.prank(PRIMARY_ACCOUNT);
        pirexCvx.deposit(assets, PRIMARY_ACCOUNT, shouldCompound);
        pirexCvx.lock();
    }

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
        @notice Transfer rpCVX to tester accounts and redeem rewards
        @param  assets                     uint256  Total rpCVX to distribute to testers
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
        uint256 tLen = testers.length;
        uint256 epoch = pxCvx.getCurrentEpoch();
        (, , , uint256[] memory allFuturesRewards) = pxCvx.getEpoch(epoch);
        totalFuturesRewards = allFuturesRewards[0];

        for (uint256 i; i < tLen; ++i) {
            (, , , uint256[] memory currentFuturesRewards) = pxCvx.getEpoch(
                epoch
            );

            // Different amounts of rpCVX distributed based on loop index and tester ordering
            // If it's the last iteration, transfer the remaining balance to ensure all rewards redeemed
            uint256 transferAmount = (tLen - 1) != i
                ? assets / (tLen - i)
                : rpCvx.balanceOf(PRIMARY_ACCOUNT, epoch);
            address tester = testers[i];

            // Cumulative attempted redemptions amounts using the same formula as `redeemFuturesRewards`
            totalAttemptedRedemptions +=
                (currentFuturesRewards[0] * transferAmount) /
                rpCvx.totalSupply(epoch);

            // Transfer rpCVX so that tester can redeem futures rewards
            _transferRpCvx(tester, epoch, transferAmount);

            // Impersonate tester and redeem futures rewards
            vm.startPrank(tester);
            rpCvx.setApprovalForAll(address(pirexCvx), true);

            // Call either the patched or bugged redeemFuturesReward method
            // `success` inconsistently returns false for bugged method so is not checked
            address(pirexCvx).call(
                abi.encodeWithSelector(selector, epoch, tester)
            );
            vm.stopPrank();

            // Total up redeemed reward amount to confirm whether redemption amount is correct
            totalRedeemedRewards += balanceOf[tester];

            // Set tester balance to zero so we can easily test future redeemed totals
            balanceOf[tester] = 0;
        }
    }

    /**
        @notice Mint reward assets, set merkle root, and claim rewards for Pirex token holders
        @param  assets  uint256  Total reward assets to mint
     */
    function _distributeEpochRewards(uint256 assets) internal {
        // Mint TEST tokens
        _mint(address(this), assets);

        // Transfer to Votium and update metadata
        _loadRewards(
            address(this),
            assets,
            keccak256(abi.encodePacked(uint256(0), address(pirexCvx), assets))
        );

        // Claim reward for PirexCvx, resulting in reward data updating for token holders
        _claimSingleReward(pirexCvx, address(this), assets);
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

        _mintAndDepositCVX(assets, false);
        _stakePxCvx(rounds, stakeAmount);

        // Forward 1 epoch, since rpCVX has claim to rewards in subsequent epochs
        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            _distributeEpochRewards(assets);

            // Distribute rpCVX to testers and redeem their futures rewards
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

        _mintAndDepositCVX(assets, false);
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

        _mintAndDepositCVX(assets, false);
        _stakePxCvx(rounds, stakeAmount);

        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            _distributeEpochRewards(assets);

            uint256 epoch = pxCvx.getCurrentEpoch();
            uint256 tLen = testers.length;

            for (uint256 j; j < tLen; ++j) {
                address tester = testers[j];

                vm.expectRevert(PirexCvx.InsufficientBalance.selector);
                vm.prank(tester);

                // Attempt redeeming rewards as the tester with zero balance
                pirexCvx.redeemFuturesRewards(epoch, tester);
            }

            vm.warp(block.timestamp + EPOCH_DURATION);
        }
    }
}
