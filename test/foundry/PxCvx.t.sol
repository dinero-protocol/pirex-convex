// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {Bytes32AddressLib} from "@rari-capital/solmate/src/utils/Bytes32AddressLib.sol";
import {HelperContract} from "./HelperContract.sol";

contract PxCvxTest is Test, HelperContract {
    using Bytes32AddressLib for address;

    PxCvx private immutable testPxCvx;

    event SetOperator(address operator);
    event UpdateEpochFuturesRewards(
        uint256 indexed epoch,
        uint256[] futuresRewards
    );

    constructor() {
        testPxCvx = new PxCvx();
    }

    function _assertEqSnapshotIds(uint256 expectedSnapshotId) internal {
        (uint256 snapshotId, , , ) = testPxCvx.getEpoch(
            testPxCvx.getCurrentEpoch()
        );

        // Check that the expected snapshot id matches both the epoch's and current
        assertEq(snapshotId, expectedSnapshotId);
        assertEq(testPxCvx.getCurrentSnapshotId(), expectedSnapshotId);
    }

    /*//////////////////////////////////////////////////////////////
                        setOperator TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetOperatorNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        testPxCvx.setOperator(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetOperatorZeroAddress() external {
        vm.expectRevert(PxCvx.ZeroAddress.selector);

        testPxCvx.setOperator(address(0));
    }

    /**
        @notice Test setting operator
     */
    function testSetOperator() external {
        assertEq(testPxCvx.operator(), address(0));
        assertEq(testPxCvx.getCurrentSnapshotId(), 0);

        address operator = address(this);

        // Should emit the following event and set the operator
        vm.expectEmit(false, false, false, true);

        emit SetOperator(operator);

        testPxCvx.setOperator(operator);

        _assertEqSnapshotIds(1);
        assertEq(testPxCvx.operator(), operator);
    }

    /*//////////////////////////////////////////////////////////////
                        getCurrentSnapshotId TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test current snapshotId getter over many epochs
     */
    function testGetCurrentSnapshotId() external {
        // Number of epochs to warp and test snapshot id incrementing
        uint256 epochs = 50;

        // Should start from 0
        _assertEqSnapshotIds(0);

        testPxCvx.setOperator(address(this));

        // Should increase to 1
        _assertEqSnapshotIds(1);

        for (uint256 i; i < epochs; ++i) {
            // Warp forward an epoch, take epoch, check incrementation
            vm.warp(block.timestamp + EPOCH_DURATION);
            testPxCvx.takeEpochSnapshot();
            _assertEqSnapshotIds(2 + i);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        getCurrentEpoch TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test current epoch getter and ensure it's congruent
     */
    function testGetCurrentEpoch() external {
        uint256 testPxCvxEpoch = testPxCvx.getCurrentEpoch();

        assertEq(testPxCvxEpoch, pirexCvx.getCurrentEpoch());
        assertEq(
            testPxCvxEpoch,
            (block.timestamp / EPOCH_DURATION) * EPOCH_DURATION
        );
    }

    /*//////////////////////////////////////////////////////////////
                        getEpoch TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test epoch getter provides the correct data
        @notice This test uses the HelperContract's pxCvx
     */
    function testGetEpoch() external {
        assertEq(pxCvx.getCurrentSnapshotId(), 1);

        // Deposit CVX so that rewards can be calculated
        _mintAndDepositCVX(1e18, address(this), true, true);

        // The amount of rewards claimed and stored in the struct
        uint256 rewardAmount = 1e18;

        vm.warp(block.timestamp + EPOCH_DURATION);
        _distributeEpochRewards(rewardAmount);

        (
            uint256 snapshotId,
            bytes32[] memory rewards,
            uint256[] memory snapshotRewards,
            uint256[] memory futuresRewards
        ) = pxCvx.getEpoch(pxCvx.getCurrentEpoch());
        (uint256 rewardFee, , ) = pirexCvx.getFees();

        assertEq(pxCvx.getCurrentSnapshotId(), 2);
        assertEq(snapshotId, 2);
        assertEq(rewards.length, 1);
        assertEq(snapshotRewards.length, 1);
        assertEq(futuresRewards.length, 1);
        assertEq(address(uint160(bytes20(rewards[0]))), address(this));
        assertEq(
            snapshotRewards[0],
            rewardAmount -
                ((rewardAmount * rewardFee) / pirexCvx.FEE_DENOMINATOR())
        );
    }

    /*//////////////////////////////////////////////////////////////
                        addEpochRewardMetadata TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test adding new epoch reward metadata
        @param  count           uint256  Number of reward records
        @param  snapshotReward  uint72   Snapshot reward amount
        @param  futuresReward   uint72   Futures reward amount
     */
    function testAddEpochRewardMetadata(
        uint256 count,
        uint72 snapshotReward,
        uint72 futuresReward
    ) external {
        vm.assume(count > 0 && count < 5);
        vm.assume(snapshotReward < 100e18);
        vm.assume(futuresReward < 100e18);

        uint256 epoch = testPxCvx.getCurrentEpoch();
        address token = address(CVX);

        testPxCvx.setOperator(address(this));

        uint256[] memory snapshotRewardAmounts = new uint256[](count);
        uint256[] memory futuresRewardAmounts = new uint256[](count);

        for (uint256 i; i < count; ++i) {
            // Use arbitrary amounts for each record
            snapshotRewardAmounts[i] = snapshotReward * (i + 1);
            futuresRewardAmounts[i] = futuresReward * (i + 1);

            testPxCvx.addEpochRewardMetadata(
                epoch,
                token.fillLast12Bytes(),
                snapshotRewardAmounts[i],
                futuresRewardAmounts[i]
            );
        }

        (
            uint256 snapshotId,
            bytes32[] memory rewards,
            uint256[] memory snapshotRewards,
            uint256[] memory futuresRewards
        ) = testPxCvx.getEpoch(epoch);

        assertEq(snapshotId, 1);
        assertEq(rewards.length, count);
        assertEq(snapshotRewards.length, count);
        assertEq(futuresRewards.length, count);

        for (uint256 i; i < count; ++i) {
            assertEq(address(uint160(bytes20(rewards[i]))), token);
            assertEq(snapshotRewards[i], snapshotRewardAmounts[i]);
            assertEq(futuresRewards[i], futuresRewardAmounts[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        setEpochRedeemedSnapshotRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test setting epoch redeemed snapshot rewards bitmap
        @param  redeemed  uint256  Redeemed bitmap
     */
    function testSetEpochRedeemedSnapshotRewards(uint16 redeemed) external {
        uint256 epoch = testPxCvx.getCurrentEpoch();
        address account = secondaryAccounts[0];

        testPxCvx.setOperator(address(this));
        testPxCvx.setEpochRedeemedSnapshotRewards(account, epoch, redeemed);

        assertEq(
            testPxCvx.getEpochRedeemedSnapshotRewards(account, epoch),
            redeemed
        );
    }

    /*//////////////////////////////////////////////////////////////
                        getEpochRedeemedSnapshotRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test setting epoch redeemed snapshot rewards bitmap
        @notice This test uses the HelperContract's pxCvx
     */
    function testGetEpochRedeemedSnapshotRewards() external {
        address account = address(this);

        // Distribute rewards so we can check epoch data
        _mintAndDepositCVX(1e18, account, false, true);

        vm.warp(block.timestamp + EPOCH_DURATION);

        _distributeEpochRewards(1e18);

        uint256 epoch = pxCvx.getCurrentEpoch();

        // Initial bitmap should be 0
        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 0);

        // Redeem the snapshot reward before checking the updated redeemed bitmap
        uint256[] memory rewardIndexes = new uint256[](1);
        rewardIndexes[0] = 0;
        pirexCvx.redeemSnapshotRewards(epoch, rewardIndexes, account);

        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 1);
    }

    /*//////////////////////////////////////////////////////////////
                        updateEpochFuturesRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotUpdateEpochFuturesRewardsNotAuthorized() external {
        uint256 epoch = testPxCvx.getCurrentEpoch();
        uint256[] memory rewards = new uint256[](1);
        rewards[0] = 1;

        vm.expectRevert(PxCvx.NotAuthorized.selector);

        testPxCvx.updateEpochFuturesRewards(epoch, rewards);
    }

    /**
        @notice Test tx reversion on invalid epoch
     */
    function testCannotUpdateEpochFuturesRewardsInvalidEpoch() external {
        uint256 epoch = 0;
        uint256[] memory rewards = new uint256[](1);
        rewards[0] = 1;

        testPxCvx.setOperator(address(this));

        // Invalid epoch on epoch = 0
        vm.expectRevert(PxCvx.InvalidEpoch.selector);

        testPxCvx.updateEpochFuturesRewards(epoch, rewards);

        // Invalid epoch on epoch doesn't have any rewards prior to the call
        epoch = testPxCvx.getCurrentEpoch();

        vm.expectRevert(PxCvx.InvalidEpoch.selector);

        testPxCvx.updateEpochFuturesRewards(epoch, rewards);
    }

    /**
        @notice Test tx reversion on invalid specified futures rewards
     */
    function testCannotUpdateEpochFuturesRewardsInvalidFuturesRewards()
        external
    {
        uint256 epoch = testPxCvx.getCurrentEpoch();
        uint256[] memory rewards = new uint256[](0);

        testPxCvx.setOperator(address(this));

        // Add initial rewards
        address token = address(CVX);

        testPxCvx.addEpochRewardMetadata(
            epoch,
            token.fillLast12Bytes(),
            100,
            100
        );

        vm.expectRevert(PxCvx.InvalidFuturesRewards.selector);

        testPxCvx.updateEpochFuturesRewards(epoch, rewards);
    }

    /**
        @notice Test tx reversion on mismatched rewards length to initially set rewards
     */
    function testCannotUpdateEpochFuturesRewardsMismatchedFuturesRewards()
        external
    {
        uint256 epoch = testPxCvx.getCurrentEpoch();
        uint256[] memory rewards = new uint256[](2);
        rewards[0] = 10;
        rewards[1] = 10;

        testPxCvx.setOperator(address(this));

        // Add initial rewards with less reward count
        address token = address(CVX);

        testPxCvx.addEpochRewardMetadata(
            epoch,
            token.fillLast12Bytes(),
            100,
            100
        );

        vm.expectRevert(PxCvx.MismatchedFuturesRewards.selector);

        testPxCvx.updateEpochFuturesRewards(epoch, rewards);
    }

    /**
        @notice Test updating epoch future rewards
        @param  count           uint256  Number of reward records
        @param  futuresReward   uint72   Futures reward amount
     */
    function testUpdateEpochFuturesRewards(uint256 count, uint72 futuresReward)
        external
    {
        vm.assume(count > 0 && count < 5);

        address token = address(CVX);
        uint256 snapshotReward = 100e18;
        uint256 initialFuturesReward = 100e18;
        uint256 epoch = testPxCvx.getCurrentEpoch();

        testPxCvx.setOperator(address(this));

        // Populate the initial reward metadata
        uint256[] memory futuresRewardAmounts = new uint256[](count);

        for (uint256 i; i < count; ++i) {
            futuresRewardAmounts[i] = initialFuturesReward * (i + 1);

            testPxCvx.addEpochRewardMetadata(
                epoch,
                token.fillLast12Bytes(),
                snapshotReward * (i + 1),
                futuresRewardAmounts[i]
            );
        }

        (, , , uint256[] memory initialFuturesRewards) = testPxCvx.getEpoch(
            epoch
        );

        for (uint256 i; i < count; ++i) {
            assertEq(initialFuturesRewards[i], futuresRewardAmounts[i]);

            // Populate the new values for future rewards before updating it
            futuresRewardAmounts[i] = futuresReward * (i + 1);
        }

        vm.expectEmit(false, false, false, true);

        emit UpdateEpochFuturesRewards(epoch, futuresRewardAmounts);

        testPxCvx.updateEpochFuturesRewards(epoch, futuresRewardAmounts);

        (, , , uint256[] memory futuresRewards) = testPxCvx.getEpoch(epoch);

        for (uint256 i; i < count; ++i) {
            assertEq(futuresRewards[i], futuresRewardAmounts[i]);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        mint TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotMintNotAuthorized() external {
        vm.expectRevert(PxCvx.NotAuthorized.selector);

        testPxCvx.mint(address(this), 1);
    }

    /**
        @notice Test tx reversion if recipient is the zero address
     */
    function testCannotMintZeroAddress() external {
        testPxCvx.setOperator(address(this));

        vm.expectRevert(PxCvx.ZeroAddress.selector);

        testPxCvx.mint(address(0), 1);
    }

    /**
        @notice Test tx reversion if mint amount is 0
     */
    function testCannotMintZeroAmount() external {
        testPxCvx.setOperator(address(this));

        vm.expectRevert(PxCvx.ZeroAmount.selector);

        testPxCvx.mint(address(this), 0);
    }

    /**
        @notice Test minting PxCvx tokens
        @param  amount  uint72  Amount of tokens to be minted
     */
    function testMint(uint72 amount) external {
        vm.assume(amount != 0);

        address account = address(this);

        testPxCvx.setOperator(address(this));

        assertEq(testPxCvx.balanceOf(account), 0);

        testPxCvx.mint(account, amount);

        assertEq(testPxCvx.balanceOf(account), amount);
    }

    /*//////////////////////////////////////////////////////////////
                        burn TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotBurnNotAuthorized() external {
        vm.expectRevert(PxCvx.NotAuthorized.selector);

        testPxCvx.burn(address(this), 1);
    }

    /**
        @notice Test tx reversion if account is the zero address
     */
    function testCannotBurnZeroAddress() external {
        testPxCvx.setOperator(address(this));

        vm.expectRevert(PxCvx.ZeroAddress.selector);

        testPxCvx.burn(address(0), 1);
    }

    /**
        @notice Test tx reversion if burn amount is 0
     */
    function testCannotBurnZeroAmount() external {
        testPxCvx.setOperator(address(this));

        vm.expectRevert(PxCvx.ZeroAmount.selector);

        testPxCvx.burn(address(this), 0);
    }

    /**
        @notice Test tx reversion if burn amount > balance
     */
    function testCannotBurnInvalidAmount() external {
        testPxCvx.setOperator(address(this));

        // Attempt to burn 1 token while having 0 token
        assertEq(testPxCvx.balanceOf(address(this)), 0);

        vm.expectRevert(stdError.arithmeticError);

        testPxCvx.burn(address(this), 1);
    }

    /**
        @notice Test burning PxCvx tokens
        @param  amount  uint72  Amount of tokens to be burned
     */
    function testBurn(uint72 amount) external {
        vm.assume(amount != 0);

        address account = address(this);

        testPxCvx.setOperator(address(this));

        // Mint proportionate amount of tokens to be burned later
        testPxCvx.mint(account, amount);

        assertEq(testPxCvx.balanceOf(account), amount);

        testPxCvx.burn(account, amount);

        assertEq(testPxCvx.balanceOf(account), 0);
    }

    /*//////////////////////////////////////////////////////////////
                        operatorApprove TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotOperatorApproveNotAuthorized() external {
        vm.expectRevert(PxCvx.NotAuthorized.selector);

        testPxCvx.operatorApprove(address(this), secondaryAccounts[0], 1);
    }

    /**
        @notice Test tx reversion if either account is the zero address
     */
    function testCannotOperatorApproveZeroAddress() external {
        testPxCvx.setOperator(address(this));

        // Invalid from/owner address
        vm.expectRevert(PxCvx.ZeroAddress.selector);

        testPxCvx.operatorApprove(address(0), secondaryAccounts[0], 1);

        // Invalid to/destination address
        vm.expectRevert(PxCvx.ZeroAddress.selector);

        testPxCvx.operatorApprove(secondaryAccounts[0], address(0), 1);
    }

    /**
        @notice Test tx reversion if amount is 0
     */
    function testCannotOperatorApproveZeroAmount() external {
        testPxCvx.setOperator(address(this));

        vm.expectRevert(PxCvx.ZeroAmount.selector);

        testPxCvx.operatorApprove(address(this), secondaryAccounts[0], 0);
    }

    /**
        @notice Test approving via operator
        @param  amount  uint72  Amount of tokens to be burned
     */
    function testOperatorApprove(uint72 amount) external {
        vm.assume(amount != 0);

        address account = secondaryAccounts[0];

        testPxCvx.setOperator(address(this));
        testPxCvx.operatorApprove(account, address(this), amount);

        assertEq(testPxCvx.allowance(account, address(this)), amount);
    }

    /*//////////////////////////////////////////////////////////////
                        takeEpochSnapshot TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if operator is not set
     */
    function testCannotTakeEpochSnapshotNoOperator() external {
        vm.expectRevert(PxCvx.NoOperator.selector);

        testPxCvx.takeEpochSnapshot();
    }

    /**
        @notice Test tx reversion if caller is not operator and operator is paused
     */
    function testCannotTakeEpochSnapshotPaused() external {
        testPxCvx.setOperator(address(this));

        // Pause self as operator so only operator can take the snapshot
        _pause();

        vm.expectRevert(PxCvx.Paused.selector);
        vm.prank(secondaryAccounts[0]);

        testPxCvx.takeEpochSnapshot();
    }

    /**
        @notice Test taking epoch snapshot
     */
    function testTakeEpochSnapshot() external {
        testPxCvx.setOperator(address(this));

        _assertEqSnapshotIds(1);

        // Should allow non operator to take the snapshot when operator is not paused
        vm.prank(secondaryAccounts[0]);

        testPxCvx.takeEpochSnapshot();

        // Taking snapshot on the same epoch should not update the snaphot
        testPxCvx.takeEpochSnapshot();

        _assertEqSnapshotIds(1);

        // Taking snapshot after a time skip to the next epoch should update the snapshot
        vm.warp(block.timestamp + EPOCH_DURATION);

        testPxCvx.takeEpochSnapshot();

        _assertEqSnapshotIds(2);
    }
}
