// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {HelperContract} from "./HelperContract.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {LpxCvx} from "contracts/LpxCvx.sol";

contract WpxCvxTest is Test, HelperContract {
    event SetCurvePool(address curvePool);

    /**
        @notice Init curvePool by performing deposit, wrapping, and initial liquidity providing
     */
    function _setupCurvePool(uint256 initialAmount) internal {
        uint256 amountPerToken = initialAmount / 2;

        // Setup to get equal amount of CVX and pxCVX
        _mintCvx(address(this), amountPerToken);
        _mintAndDepositCVX(
            amountPerToken,
            address(this),
            false,
            address(0),
            true
        );

        // Wrap the pxCVX into wpxCVX
        pxCvx.approve(address(lpxCvx), type(uint256).max);
        lpxCvx.wrap(amountPerToken);

        // Transfer the tokens to the helper to add first liquidity
        CVX.transfer(address(curvePoolHelper), amountPerToken);
        lpxCvx.transfer(address(curvePoolHelper), amountPerToken);
        curvePoolHelper.initPool(amountPerToken, amountPerToken);

        // Set the curvePool contract address
        lpxCvx.setCurvePool(curvePoolHelper.poolAddress());
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

        lpxCvx.setPirexCvx(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetPirexCvxZeroAddress() external {
        vm.expectRevert(LpxCvx.ZeroAddress.selector);

        lpxCvx.setPirexCvx(address(0));
    }

    /**
        @notice Test setting pirexCvx
     */
    function testSetPirexCvx() external {
        address oldContract = address(lpxCvx.pirexCvx());
        address newContract = address(this);

        lpxCvx.setPirexCvx(newContract);

        address updatedContract = address(lpxCvx.pirexCvx());

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

        lpxCvx.setCurvePool(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetCurvePoolZeroAddress() external {
        vm.expectRevert(LpxCvx.ZeroAddress.selector);

        lpxCvx.setCurvePool(address(0));
    }

    /**
        @notice Test setting curvePool
     */
    function testSetCurvePool() external {
        address oldContract = address(lpxCvx.curvePool());
        address newContract = curvePoolHelper.poolAddress();

        vm.expectEmit(true, false, false, true);

        emit SetCurvePool(newContract);

        lpxCvx.setCurvePool(newContract);

        address updatedContract = address(lpxCvx.curvePool());

        assertFalse(oldContract == newContract);
        assertEq(oldContract, address(0));
        assertEq(updatedContract, newContract);

        // Check the allowances
        assertEq(CVX.allowance(address(lpxCvx), oldContract), 0);
        assertEq(lpxCvx.allowance(address(lpxCvx), oldContract), 0);
        assertEq(
            CVX.allowance(address(lpxCvx), newContract),
            type(uint256).max
        );
        assertEq(
            lpxCvx.allowance(address(lpxCvx), newContract),
            type(uint256).max
        );
    }

    /**
        @notice Test updating curvePool
     */
    function testSetCurvePoolUpdate() external {
        // Should be initially address(0)
        assertEq(address(lpxCvx.curvePool()), address(0));

        address oldContract = address(this);
        address newContract = curvePoolHelper.poolAddress();

        // First time setting curvePool
        lpxCvx.setCurvePool(oldContract);

        assertEq(address(lpxCvx.curvePool()), oldContract);

        vm.expectEmit(true, false, false, true);

        emit SetCurvePool(newContract);

        // Attempt to update the curvePool again with actual pool
        lpxCvx.setCurvePool(newContract);

        address updatedContract = address(lpxCvx.curvePool());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);

        // Check the allowances
        assertEq(CVX.allowance(address(lpxCvx), oldContract), 0);
        assertEq(lpxCvx.allowance(address(lpxCvx), oldContract), 0);
        assertEq(
            CVX.allowance(address(lpxCvx), newContract),
            type(uint256).max
        );
        assertEq(
            lpxCvx.allowance(address(lpxCvx), newContract),
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

        lpxCvx.setRewardReceiver(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetRewardReceiverZeroAddress() external {
        vm.expectRevert(LpxCvx.ZeroAddress.selector);

        lpxCvx.setRewardReceiver(address(0));
    }

    /**
        @notice Test setting rewardReceiver
     */
    function testSetRewardReceiver() external {
        address oldReceiver = address(lpxCvx.rewardReceiver());
        address newReceiver = address(this);

        lpxCvx.setRewardReceiver(newReceiver);

        address updatedReceiver = address(lpxCvx.rewardReceiver());

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

        lpxCvx.redeemRewards(0, rewardIndexes);
    }

    /**
        @notice Test tx reversion on invalid epoch
     */
    function testCannotRedeemRewardsInvalidEpoch() external {
        uint256[] memory rewardIndexes = new uint256[](0);

        vm.expectRevert(PirexCvx.InvalidEpoch.selector);

        lpxCvx.redeemRewards(0, rewardIndexes);
    }

    /**
        @notice Test tx reversion on invalid index array
     */
    function testCannotRedeemRewardsEmptyArray() external {
        uint256[] memory rewardIndexes = new uint256[](0);

        vm.expectRevert(PirexCvx.EmptyArray.selector);

        lpxCvx.redeemRewards(1, rewardIndexes);
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

        lpxCvx.setRewardReceiver(TREASURY);

        address account = address(lpxCvx);
        address rewardReceiver = lpxCvx.rewardReceiver();
        uint256 epoch = pirexCvx.getCurrentEpoch();
        (uint256 snapshotId, , uint256[] memory snapshotRewards, ) = pxCvx
            .getEpoch(epoch);
        uint256[] memory rewardIndexes = new uint256[](1);
        rewardIndexes[0] = 0;

        // Confirm that no redemption has been performed yet
        uint256 oldReceiverBalance = balanceOf[rewardReceiver];
        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 0);

        lpxCvx.redeemRewards(epoch, rewardIndexes);

        uint256 snapshotBalance = pxCvx.balanceOfAt(account, snapshotId);
        uint256 snapshotSupply = pxCvx.totalSupplyAt(snapshotId);

        // Check the updated token balance and reward redemption bitmap for the receiver
        assertEq(
            balanceOf[rewardReceiver] - oldReceiverBalance,
            (snapshotRewards[0] * snapshotBalance) / snapshotSupply
        );
        assertEq(pxCvx.getEpochRedeemedSnapshotRewards(account, epoch), 1);
    }

    /*//////////////////////////////////////////////////////////////
                        wrap TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion on zero amount
     */
    function testCannotWrapZeroAmount() external {
        vm.expectRevert(LpxCvx.ZeroAmount.selector);

        lpxCvx.wrap(0);
    }

    /**
        @notice Test tx reversion on insufficient balance
     */
    function testCannotWrapInsufficientBalance() external {
        pxCvx.approve(address(lpxCvx), type(uint256).max);

        vm.expectRevert("TRANSFER_FROM_FAILED");

        lpxCvx.wrap(1);
    }

    /**
        @notice Test wrapping pxCVX into wpxCVX
        @param  amount  uint72  Amount to be wrapped
     */
    function testWrap(uint72 amount) external {
        vm.assume(amount != 0);

        address account = address(this);

        // Deposit to get some pxCVX to be wrapped later
        _mintAndDepositCVX(amount, account, false, address(0), true);

        pxCvx.approve(address(lpxCvx), type(uint256).max);

        uint256 wpxCvxBalanceBefore = lpxCvx.balanceOf(account);
        uint256 pxCvxBalanceBefore = pxCvx.balanceOf(account);

        // Wrap the pxCVX into wpxCVX
        lpxCvx.wrap(amount);

        assertEq(lpxCvx.balanceOf(account), wpxCvxBalanceBefore + amount);
        assertEq(pxCvx.balanceOf(account), pxCvxBalanceBefore - amount);
    }

    /*//////////////////////////////////////////////////////////////
                        unwrap TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion on zero amount
     */
    function testCannotUnwrapZeroAmount() external {
        vm.expectRevert(LpxCvx.ZeroAmount.selector);

        lpxCvx.unwrap(0);
    }

    /**
        @notice Test tx reversion on insufficient balance
     */
    function testCannotUnwrapInsufficientBalance() external {
        lpxCvx.approve(address(lpxCvx), type(uint256).max);

        vm.expectRevert(stdError.arithmeticError);

        lpxCvx.unwrap(1);
    }

    /**
        @notice Test unwrapping wpxCVX back into pxCVX
        @param  amount  uint72  Amount to be unwrapped
     */
    function testUnwrap(uint72 amount) external {
        vm.assume(amount != 0);

        address account = address(this);

        // Deposit to get some pxCVX to be wrapped later
        _mintAndDepositCVX(amount, account, false, address(0), true);

        pxCvx.approve(address(lpxCvx), type(uint256).max);
        lpxCvx.approve(address(lpxCvx), type(uint256).max);

        uint256 wpxCvxBalanceBefore = lpxCvx.balanceOf(account);
        uint256 pxCvxBalanceBefore = pxCvx.balanceOf(account);

        // Wrap first so we have some wpxCVX to test unwrapping
        lpxCvx.wrap(amount);

        assertEq(lpxCvx.balanceOf(account), wpxCvxBalanceBefore + amount);
        assertEq(pxCvx.balanceOf(account), pxCvxBalanceBefore - amount);

        // Attempt to unwrap
        lpxCvx.unwrap(amount);

        assertEq(lpxCvx.balanceOf(account), wpxCvxBalanceBefore);
        assertEq(pxCvx.balanceOf(account), pxCvxBalanceBefore);
    }

    /*//////////////////////////////////////////////////////////////
                        swap TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if the curvePool is not yet set
     */
    function testCannotSwapPoolNotSet() external {
        vm.expectRevert(LpxCvx.PoolNotSet.selector);

        lpxCvx.swap(LpxCvx.Token.CVX, 1, 1, 0, 1);
    }

    /**
        @notice Test tx reversion on zero amount
     */
    function testCannotSwapZeroAmount() external {
        _setupCurvePool(10e18);

        vm.expectRevert(LpxCvx.ZeroAmount.selector);

        lpxCvx.swap(LpxCvx.Token.CVX, 0, 1, 0, 1);

        vm.expectRevert(LpxCvx.ZeroAmount.selector);

        lpxCvx.swap(LpxCvx.Token.CVX, 1, 0, 0, 1);
    }

    /**
        @notice Test tx reversion on invalid indices
     */
    function testCannotSwapInvalidIndices() external {
        _setupCurvePool(10e18);

        vm.expectRevert(LpxCvx.InvalidIndices.selector);

        lpxCvx.swap(LpxCvx.Token.CVX, 1, 1, 0, 0);
    }

    /**
        @notice Test swapping from source to counterpart token
        @param  source  uint8   Integer representation of the token enum
        @param  amount  uint72  Amount to be swapped
     */
    function testSwap(uint8 source, uint72 amount) external {
        vm.assume(source <= uint8(type(LpxCvx.Token).max));
        vm.assume(amount > 1e18);

        // Setup the curvePool with large enough liquidity
        _setupCurvePool(uint256(amount) * 10);

        address account = address(this);
        LpxCvx.Token sourceToken = LpxCvx.Token(source);

        if (sourceToken == LpxCvx.Token.pxCVX) {
            _mintAndDepositCVX(amount, account, false, address(0), true);

            pxCvx.approve(address(lpxCvx), amount);

            uint256 cvxBalanceBefore = CVX.balanceOf(account);
            uint256 pxCvxBalanceBefore = pxCvx.balanceOf(account);

            // Test swapping from pxCVX to CVX with zero slippage
            uint256 minReceived = curvePoolHelper.getDy(1, 0, amount);
            lpxCvx.swap(sourceToken, amount, minReceived, 1, 0);

            assertEq(CVX.balanceOf(account), cvxBalanceBefore + minReceived);
            assertEq(pxCvx.balanceOf(account), pxCvxBalanceBefore - amount);
        } else {
            _mintCvx(account, amount);

            CVX.approve(address(lpxCvx), amount);

            uint256 cvxBalanceBefore = CVX.balanceOf(account);
            uint256 pxCvxBalanceBefore = pxCvx.balanceOf(account);

            // Test swapping from CVX to pxCVX with zero slippage
            uint256 minReceived = curvePoolHelper.getDy(0, 1, amount);
            lpxCvx.swap(sourceToken, amount, minReceived, 0, 1);

            assertEq(CVX.balanceOf(account), cvxBalanceBefore - amount);
            assertEq(
                pxCvx.balanceOf(account),
                pxCvxBalanceBefore + minReceived
            );
        }
    }
}
