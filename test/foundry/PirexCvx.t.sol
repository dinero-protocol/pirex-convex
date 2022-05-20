// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/tokens/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {CvxLockerV2} from "contracts/mocks/CvxLocker.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxTest is Test, HelperContract {
    uint32 private immutable FEE_MAX;

    event AddDeveloper(address developer);
    event RemoveDeveloper(address developer);

    constructor() {
        FEE_MAX = pirexCvx.FEE_MAX();
    }

    event InitializeFees(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    );

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
        @notice Set up state to test initiating redemptions
        @param  assets            uint256    Assets to deposit
        @return lockIndexes       uint256[]  Lock data indexes
        @return redemptionAssets  uint256[]  Assets to redeem
     */
    function _setUpInitiateRedemptions(uint256 assets)
        internal
        returns (
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        )
    {
        // Deposit CVX and get pxCVX - used for redemptions
        _mintAndDepositCVX(assets, address(this), false, address(0), true);

        (, , , CvxLockerV2.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        lockIndexes = new uint256[](1);
        redemptionAssets = new uint256[](1);
        lockIndexes[0] = 0;
        redemptionAssets[0] = assets;
    }

    /*//////////////////////////////////////////////////////////////
                        redeemFuturesRewards TESTS
    //////////////////////////////////////////////////////////////*/

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

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, address(0), true);
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

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, address(0), true);
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

        _mintAndDepositCVX(assets, PRIMARY_ACCOUNT, false, address(0), true);
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

    /*//////////////////////////////////////////////////////////////
                        claimMiscRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Not the actual method itself but relevant due to the fatal issue of
                duplicate reward tokens rendering the misc. rewards forever unclaimable.
                This test verifies that the issue is not a realistic concern, as dupe
                tokens cannot be added via the CvxLockerV2's addReward method
     */
    function testCannotAddRewardDuplicate() external {
        vm.startPrank(CVX_LOCKER.owner());

        // Successfully added the first time
        CVX_LOCKER.addReward(address(this), address(this), false);

        vm.expectRevert();

        // Reverts due to `lastUpdateTime` being set for the token (previous call)
        CVX_LOCKER.addReward(address(this), address(this), false);

        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                        setFee TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reverts if not owner
     */
    function testCannotSetFeeNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setFee(PirexCvx.Fees.Reward, 1);
    }

    /**
        @notice Test tx reverts if fee amount exceeds max
     */
    function testCannotSetFeeExceedsMax() external {
        PirexCvx.Fees[3] memory feeTypes;
        feeTypes[0] = PirexCvx.Fees.Reward;
        feeTypes[1] = PirexCvx.Fees.RedemptionMax;
        feeTypes[2] = PirexCvx.Fees.RedemptionMin;

        for (uint256 i; i < feeTypes.length; ++i) {
            vm.expectRevert(PirexCvx.InvalidFee.selector);

            pirexCvx.setFee(feeTypes[i], FEE_MAX + 1);
        }
    }

    /**
        @notice Test tx reverts if redemption max fee is less than min
     */
    function testCannotSetFeeRedemptionMaxLessThanMin() external {
        (, , uint32 redemptionMin, ) = pirexCvx.getFees();

        vm.expectRevert(PirexCvx.InvalidFee.selector);

        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMin - 1);
    }

    /**
        @notice Test tx reverts if redemption min fee is greater than max
     */
    function testCannotSetFeeRedemptionMinLessThanMax() external {
        (, uint32 redemptionMax, , ) = pirexCvx.getFees();

        vm.expectRevert(PirexCvx.InvalidFee.selector);

        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMax + 1);
    }

    /**
        @notice Test setting fees for each type
     */
    function testSetFee(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    ) external {
        vm.assume(
            reward < FEE_MAX &&
                redemptionMax < FEE_MAX &&
                redemptionMin < FEE_MAX
        );
        vm.assume(redemptionMax > redemptionMin);

        _resetFees();

        pirexCvx.setFee(PirexCvx.Fees.Reward, reward);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMax);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMin);
    }

    /*//////////////////////////////////////////////////////////////
                        initiateRedemptions TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test that the tx reverts if redemptionMax is zero with faulty method.
                In addition to the `ZeroAmount` error, it was previously possible for
                redemptionMax to be set below redemptionMin, causing an underflow error -
                with the latest set of fixes, that is no longer possible.
                
     */
    function testCannotInitiateRedemptionsFaultyZeroRedemptionMax() external {
        _resetFees();

        (
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setUpInitiateRedemptions(1e18);

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
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setUpInitiateRedemptions(1e18);
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
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setUpInitiateRedemptions(1e18);
        (, uint32 redemptionMax, uint32 redemptionMin, ) = pirexCvx.getFees();

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
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setUpInitiateRedemptions(1e18);
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
        @notice Test fuzzing initiating redemptions with various redemption fees
        @param  redemptionMaxFee  uint32  Redemption max fee
        @param  redemptionMinFee  uint32  Redemption min fee
     */
    function testInitiateRedemptionsForRedemptionFees(
        uint32 redemptionMaxFee,
        uint32 redemptionMinFee
    ) external {
        vm.assume(redemptionMaxFee < FEE_MAX);
        vm.assume(redemptionMinFee < FEE_MAX);
        vm.assume(redemptionMaxFee > redemptionMinFee);

        _resetFees();
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMaxFee);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMinFee);

        (
            uint256[] memory lockIndexes,
            uint256[] memory redemptionAssets
        ) = _setUpInitiateRedemptions(1e18);
        (, uint32 redemptionMax, uint32 redemptionMin, ) = pirexCvx.getFees();

        pirexCvx.initiateRedemptions(
            lockIndexes,
            PirexCvx.Futures.Reward,
            redemptionAssets,
            address(this)
        );
    }

    /*//////////////////////////////////////////////////////////////
                        addDeveloper TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reverts if not owner
     */
    function testCannotAddDeveloperNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.addDeveloper(address(this));
    }

    /**
        @notice Test tx reverts if developer arg is zero address
     */
    function testCannotAddDeveloperZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.addDeveloper(address(0));
    }

    /**
        @notice Test add developer
     */
    function testAddDeveloper() external {
        address developer = PRIMARY_ACCOUNT;

        assertEq(pirexCvx.developers(developer), false);

        vm.expectEmit(false, false, false, true);

        emit AddDeveloper(developer);

        pirexCvx.addDeveloper(developer);

        assertEq(pirexCvx.developers(developer), true);
    }

    /*//////////////////////////////////////////////////////////////
                        removeDeveloper TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reverts if not owner
     */
    function testCannotRemoveDeveloperNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.removeDeveloper(address(this));
    }

    /**
        @notice Test tx reverts if developer arg is zero address
     */
    function testCannotRemoveDeveloperZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.removeDeveloper(address(0));
    }

    /**
        @notice Test remove developer
     */
    function testRemoveDeveloper() external {
        address developer = PRIMARY_ACCOUNT;

        pirexCvx.addDeveloper(developer);

        assertEq(pirexCvx.developers(developer), true);

        vm.expectEmit(false, false, false, true);

        emit RemoveDeveloper(developer);

        pirexCvx.removeDeveloper(developer);

        assertEq(pirexCvx.developers(developer), false);
    }

    /*//////////////////////////////////////////////////////////////
                        deposit TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test revert if paused
     */
    function testCannotDepositPaused() external {
        uint256 assets = 1e18;
        address receiver = address(this);
        bool shouldCompound = true;
        address developer = address(0);

        pirexCvx.setPauseState(true);

        assertEq(pirexCvx.paused(), true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.deposit(assets, receiver, shouldCompound, developer);
    }

    /**
        @notice Test revert if assets is zero
     */
    function testCannotDepositZeroAssets() external {
        uint256 invalidAssets = 0;
        address receiver = address(this);
        bool shouldCompound = true;
        address developer = address(0);

        vm.expectRevert(PirexCvx.ZeroAmount.selector);

        pirexCvx.deposit(invalidAssets, receiver, shouldCompound, developer);
    }

    /**
        @notice Test revert if receiver is zero address
     */
    function testCannotDepositZeroAddressReceiver() external {
        uint256 assets = 1e18;
        address invalidReceiver = address(0);
        bool shouldCompound = true;
        address developer = address(0);

        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.deposit(assets, invalidReceiver, shouldCompound, developer);
    }

    /**
        @notice Test deposit and compound pxCVX
     */
    function testDepositShouldNotCompound() external {
        uint256 assets = 1e18;
        address receiver = address(this);
        bool shouldCompound = false;
        address developer = address(0);

        assertEq(pxCvx.balanceOf(receiver), 0);
        assertEq(CVX.balanceOf(address(pirexCvx)), 0);

        _mintCvx(address(this), assets);
        CVX.approve(address(pirexCvx), assets);
        pirexCvx.deposit(assets, receiver, shouldCompound, developer);

        assertEq(pxCvx.balanceOf(receiver), assets);
        assertEq(CVX.balanceOf(address(pirexCvx)), assets);
    }

    /**
        @notice Test deposit without compounding pxCVX
     */
    function testDepositShouldCompound() external {
        uint256 assets = 1e18;
        address receiver = address(this);
        bool shouldCompound = true;
        address developer = address(0);

        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), 0);
        assertEq(CVX.balanceOf(address(pirexCvx)), 0);
        assertEq(unionPirex.balanceOf(receiver), 0);

        _mintCvx(address(this), assets);
        CVX.approve(address(pirexCvx), assets);
        pirexCvx.deposit(assets, receiver, shouldCompound, developer);

        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), assets);
        assertEq(CVX.balanceOf(address(pirexCvx)), assets);
        assertEq(unionPirex.balanceOf(receiver), assets);
    }

    /**
        @notice Test deposit with developer incentive
     */
    function testDepositDeveloperIncentive() external {
        uint256 assets = 1e18;
        address receiver = address(this);
        bool shouldCompound = true;
        address developer = PRIMARY_ACCOUNT;
        uint32 fee = 10000;

        pirexCvx.addDeveloper(developer);
        pirexCvx.setFee(PirexCvx.Fees.Developers, fee);

        assertEq(pirexCvx.developers(developer), true);
        assertEq(pirexCvx.fees(PirexCvx.Fees.Developers), fee);
        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), 0);
        assertEq(CVX.balanceOf(address(pirexCvx)), 0);
        assertEq(unionPirex.balanceOf(receiver), 0);
        assertEq(pxCvx.balanceOf(developer), 0);

        _mintCvx(address(this), assets);
        CVX.approve(address(pirexCvx), assets);
        pirexCvx.deposit(assets, receiver, shouldCompound, developer);

        uint256 feeAmount = (assets * fee) / pirexCvx.FEE_DENOMINATOR();
        uint256 receivedAmount = assets - feeAmount;

        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), receivedAmount);
        assertEq(CVX.balanceOf(address(pirexCvx)), receivedAmount);
        assertEq(unionPirex.balanceOf(receiver), receivedAmount);
        assertEq(pxCvx.balanceOf(developer), feeAmount);
    }

    /**
        @notice Test deposit without developer incentive
     */
    function testDepositNoDeveloperIncentive() external {
        uint256 assets = 1e18;
        address receiver = address(this);
        bool shouldCompound = true;
        address developer = PRIMARY_ACCOUNT;
        uint32 fee = 10000;

        // Set fee but do not add developer
        pirexCvx.setFee(PirexCvx.Fees.Developers, fee);

        assertEq(pirexCvx.developers(developer), false);
        assertEq(pirexCvx.fees(PirexCvx.Fees.Developers), fee);
        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), 0);
        assertEq(CVX.balanceOf(address(pirexCvx)), 0);
        assertEq(unionPirex.balanceOf(receiver), 0);
        assertEq(pxCvx.balanceOf(developer), 0);

        _mintCvx(address(this), assets);
        CVX.approve(address(pirexCvx), assets);
        pirexCvx.deposit(assets, receiver, shouldCompound, developer);

        assertEq(pxCvx.balanceOf(address(unionPirexStrategy)), assets);
        assertEq(CVX.balanceOf(address(pirexCvx)), assets);
        assertEq(unionPirex.balanceOf(receiver), assets);
        assertEq(pxCvx.balanceOf(developer), 0);
    }
}
