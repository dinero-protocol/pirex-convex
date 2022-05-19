// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/tokens/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxRewardTest is Test, HelperContract {
    /**
        @notice Add the specified tokens to Votium
        @param  tokens  address[]  Token addresses
        @param  amount  uint256    Amount
     */
    function _addVotiumRewards(address[] memory tokens, uint256 amount)
        internal
    {
        uint256 tLen = tokens.length;

        PirexCvx.VotiumReward[]
            memory votiumRewards = new PirexCvx.VotiumReward[](tLen);

        for (uint256 i; i < tLen; ++i) {
            // Mint tokens before adding it as a claimable votium reward record
            address token = tokens[i];

            // Transfer to Votium and update metadata
            _loadRewards(
                token,
                amount,
                keccak256(
                    abi.encodePacked(uint256(i), address(pirexCvx), amount)
                )
            );

            PirexCvx.VotiumReward memory votiumReward;
            votiumReward.token = token;
            votiumReward.index = i;
            votiumReward.amount = amount;
            votiumReward.merkleProof = new bytes32[](0);

            votiumRewards[i] = votiumReward;
        }

        pirexCvx.claimVotiumRewards(votiumRewards);
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
        @param  rounds        uint8    Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint8    Percent of pxCVX to stake (255 is denominator)
     */
    function _redeemFuturesRewardsFuzzParameters(
        uint8 rounds,
        uint256 assets,
        uint8 stakePercent
    ) internal {
        vm.assume(rounds != 0);
        vm.assume(rounds < 10);
        vm.assume(assets != 0);
        vm.assume(assets < 10000e18);
        vm.assume(assets > 1e18);
        vm.assume(stakePercent != 0);
        vm.assume(stakePercent < 255);
    }

    /*//////////////////////////////////////////////////////////////
                        claimVotiumRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if contract is paused
     */
    function testCannotClaimVotiumRewardsPaused() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Pausable: paused");

        _claimSingleReward(address(this), 1);
    }

    /**
        @notice Test tx reversion if claiming with empty array
     */
    function testCannotClaimVotiumRewardsEmptyArray() external {
        PirexCvx.VotiumReward[]
            memory votiumRewards = new PirexCvx.VotiumReward[](0);

        vm.expectRevert(PirexCvx.EmptyArray.selector);

        pirexCvx.claimVotiumRewards(votiumRewards);
    }

    /**
        @notice Test tx reversion if claiming with invalid token address
     */
    function testCannotClaimVotiumRewardsZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        _claimSingleReward(address(0), 1);
    }

    /**
        @notice Test tx reversion if claiming with zero amount
     */
    function testCannotClaimVotiumRewardsZeroAmount() external {
        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        _claimSingleReward(address(this), 0);
    }

    /**
        @notice Test claiming votium rewards
        @param  amount  uint256  Token amount
     */
    function testClaimVotiumRewards(uint72 amount) external {
        vm.assume(amount > 1000);

        // Populate and stake PxCvx for the snapshot
        uint256 asset = 1e18;

        _mintAndDepositCVX(asset, PRIMARY_ACCOUNT, false, true);

        vm.prank(PRIMARY_ACCOUNT);

        pirexCvx.stake(5, PirexCvx.Futures.Reward, asset, PRIMARY_ACCOUNT);

        vm.warp(block.timestamp + EPOCH_DURATION);

        address[] memory tokens = new address[](2);
        tokens[0] = address(CVX);
        tokens[1] = address(this);

        uint256 tLen = tokens.length;

        // Mint the required tokens first before we can transfer it to Votium
        _mintCvx(address(this), amount);
        _mint(address(this), amount);

        // Add the specified tokens as Votium rewards separately to avoid "Stack too deep" issue
        _addVotiumRewards(tokens, amount);

        // Validate reward distributions
        for (uint256 i; i < tLen; ++i) {
            uint256 epoch = pirexCvx.getCurrentEpoch();
            (uint256 snapshotId, , , ) = pxCvx.getEpoch(epoch);

            (
                uint256 rewardFee,
                uint256 snapshotRewards,
                uint256 futuresRewards
            ) = pirexCvx.calculateRewards(
                    pirexCvx.fees(PirexCvx.Fees.Reward),
                    pxCvx.totalSupplyAt(snapshotId),
                    rpCvx.totalSupply(epoch),
                    amount
                );

            assertEq(rewardFee + snapshotRewards + futuresRewards, amount);
            assertEq(
                IERC20(tokens[i]).balanceOf(address(pirexCvx)),
                snapshotRewards + futuresRewards
            );
        }
    }

    /*//////////////////////////////////////////////////////////////
                        redeemFuturesRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Fuzz the patched version of redeemFuturesRewards to verify now correctly implemented
        @param  rounds        uint8    Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint8    Percent of pxCVX to stake
     */
    function testRedeemFuturesRewards(
        uint8 rounds,
        uint256 assets,
        uint8 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);

        vm.prank(PRIMARY_ACCOUNT);

        pirexCvx.stake(
            rounds,
            PirexCvx.Futures.Reward,
            assets,
            PRIMARY_ACCOUNT
        );

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
        @param  rounds        uint8    Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint8    Percent of pxCVX to stake
     */
    function testRedeemFuturesRewardsBugged(
        uint8 rounds,
        uint256 assets,
        uint8 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);

        vm.prank(PRIMARY_ACCOUNT);

        pirexCvx.stake(
            rounds,
            PirexCvx.Futures.Reward,
            assets,
            PRIMARY_ACCOUNT
        );

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
        @param  rounds        uint8    Number of staking rounds
        @param  assets        uint256  pxCVX amount
        @param  stakePercent  uint8    Percent of pxCVX to stake
     */
    function testCannotRedeemFuturesRewardsInsufficientBalance(
        uint8 rounds,
        uint256 assets,
        uint8 stakePercent
    ) external {
        _redeemFuturesRewardsFuzzParameters(rounds, assets, stakePercent);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, true);

        vm.prank(PRIMARY_ACCOUNT);

        pirexCvx.stake(
            rounds,
            PirexCvx.Futures.Reward,
            assets,
            PRIMARY_ACCOUNT
        );

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
