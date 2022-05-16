// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {Counters} from "@openzeppelin/contracts/utils/Counters.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {HelperContract} from "./HelperContract.sol";

contract PxCvxTest is Test, HelperContract {
    PxCvx private immutable testPxCvx;

    event SetOperator(address operator);

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

    function testCannotSetOperatorNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);
        testPxCvx.setOperator(address(this));
    }

    function testCannotSetOperatorZeroAddress() external {
        vm.expectRevert(PxCvx.ZeroAddress.selector);
        testPxCvx.setOperator(address(0));
    }

    function testSetOperator() external {
        assertEq(testPxCvx.operator(), address(0));
        assertEq(testPxCvx.getCurrentSnapshotId(), 0);

        address operator = address(this);

        // Should emit the following event and set the operator
        vm.expectEmit(false, false, false, true);
        emit SetOperator(operator);
        testPxCvx.setOperator(operator);

        _assertEqSnapshotIds(uint256(1));
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

        // Distribute rewards so we can check epoch data
        _mintAndDepositCVX(1e18, address(this), true, true);
        vm.warp(block.timestamp + EPOCH_DURATION);
        _distributeEpochRewards(1e18);

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
        assertEq(snapshotRewards[0], 1e18 - (1e18 * rewardFee / pirexCvx.FEE_DENOMINATOR()));
    }
}
