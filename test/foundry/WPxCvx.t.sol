// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {HelperContract} from "./HelperContract.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {WPxCvx} from "contracts/WPxCvx.sol";

contract WPxCvxTest is Test, HelperContract {
    /**
        @notice Init curvePool by performing deposit, wrapping, and initial liquidity providing
     */
    function _setupCurvePool(uint72 initialAmount) internal {
        uint72 amountPerToken = initialAmount / 2;

        _mintCvx(address(this), amountPerToken);
        _mintAndDepositCVX(
            amountPerToken,
            address(this),
            false,
            address(0),
            false
        );

        pxCvx.approve(address(wpxCvx), type(uint256).max);

        wpxCvx.wrap(amountPerToken);

        CVX.transfer(address(curvePoolHelper), amountPerToken);
        wpxCvx.transfer(address(curvePoolHelper), amountPerToken);

        curvePoolHelper.initPool(amountPerToken, amountPerToken);
    }

    /*//////////////////////////////////////////////////////////////
                        setPirexCvx TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetPirexCvxNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        wpxCvx.setPirexCvx(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetPirexCvxZeroAddress() external {
        vm.expectRevert(WPxCvx.ZeroAddress.selector);

        wpxCvx.setPirexCvx(address(0));
    }

    /**
        @notice Test setting pirexCvx
     */
    function testSetPirexCvx() external {
        address oldContract = address(wpxCvx.pirexCvx());
        address newContract = address(this);

        wpxCvx.setPirexCvx(newContract);

        address updatedContract = address(wpxCvx.pirexCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /*//////////////////////////////////////////////////////////////
                        setCurvePool TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetCurvePoolNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        wpxCvx.setCurvePool(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetCurvePoolZeroAddress() external {
        vm.expectRevert(WPxCvx.ZeroAddress.selector);

        wpxCvx.setCurvePool(address(0));
    }

    /**
        @notice Test setting curvePool
     */
    function testSetCurvePool() external {
        address oldContract = address(wpxCvx.curvePool());
        address newContract = address(this);

        wpxCvx.setCurvePool(newContract);

        address updatedContract = address(wpxCvx.curvePool());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);

        // Check the allowances
        assertEq(CVX.allowance(address(wpxCvx), oldContract), 0);
        assertEq(wpxCvx.allowance(address(wpxCvx), oldContract), 0);
        assertEq(
            CVX.allowance(address(wpxCvx), newContract),
            type(uint256).max
        );
        assertEq(
            wpxCvx.allowance(address(wpxCvx), newContract),
            type(uint256).max
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setRewardReceiver TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetRewardReceiverNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        wpxCvx.setRewardReceiver(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetRewardReceiverZeroAddress() external {
        vm.expectRevert(WPxCvx.ZeroAddress.selector);

        wpxCvx.setRewardReceiver(address(0));
    }

    /**
        @notice Test setting rewardReceiver
     */
    function testSetRewardReceiver() external {
        address oldReceiver = address(wpxCvx.rewardReceiver());
        address newReceiver = address(this);

        wpxCvx.setRewardReceiver(newReceiver);

        address updatedReceiver = address(wpxCvx.rewardReceiver());

        assertFalse(oldReceiver == newReceiver);
        assertEq(updatedReceiver, newReceiver);
    }

    /*//////////////////////////////////////////////////////////////
                        redeemRewards TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if pirexCvx is paused
     */
    function testCannotRedeemRewardsPaused() external {
        pirexCvx.setPauseState(true);

        uint256[] memory rewardIndexes = new uint256[](0);

        vm.expectRevert("Pausable: paused");

        wpxCvx.redeemRewards(0, rewardIndexes);
    }

    /**
        @notice Test tx reversion on invalid epoch
     */
    function testCannotRedeemRewardsInvalidEpoch() external {
        uint256[] memory rewardIndexes = new uint256[](0);

        vm.expectRevert(PirexCvx.InvalidEpoch.selector);

        wpxCvx.redeemRewards(0, rewardIndexes);
    }

    /**
        @notice Test tx reversion on invalid index array
     */
    function testCannotRedeemRewardsEmptyArray() external {
        uint256[] memory rewardIndexes = new uint256[](0);

        vm.expectRevert(PirexCvx.EmptyArray.selector);

        wpxCvx.redeemRewards(1, rewardIndexes);
    }

    /**
        @notice Test redeeming rewards for LP
        @param  lpAmount  uint72  Total amount of initial liquidity for the curvePool
        @param  amount    uint72  Amount of rewards
     */
    function testRedeemRewards(uint72 lpAmount, uint72 amount) external {
        vm.assume(lpAmount > 10e18);
        vm.assume(amount != 0);

        _setupCurvePool(lpAmount);

        vm.warp(block.timestamp + EPOCH_DURATION);

        _distributeEpochRewards(amount);

        wpxCvx.setRewardReceiver(TREASURY);

        address account = address(wpxCvx);
        address rewardReceiver = wpxCvx.rewardReceiver();
        uint256 epoch = pirexCvx.getCurrentEpoch();
        (uint256 snapshotId, , uint256[] memory snapshotRewards, ) = pxCvx
            .getEpoch(epoch);
        uint256[] memory rewardIndexes = new uint256[](1);
        rewardIndexes[0] = 0;

        // Confirm that no redemption has been performed yet
        uint256 oldReceiverBalance = balanceOf[rewardReceiver];
        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 0);

        wpxCvx.redeemRewards(epoch, rewardIndexes);

        uint256 snapshotBalance = pxCvx.balanceOfAt(account, snapshotId);
        uint256 snapshotSupply = pxCvx.totalSupplyAt(snapshotId);

        // Check the updated token balance and reward redemption bitmap for the receiver
        assertEq(
            balanceOf[rewardReceiver] - oldReceiverBalance,
            (snapshotRewards[0] * snapshotBalance) / snapshotSupply
        );
        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 1);
    }
}
