// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {DelegateRegistry} from "contracts/mocks/DelegateRegistry.sol";
import {HelperContract} from "./HelperContract.sol";
import {CvxLockerV2} from "contracts/mocks/CvxLocker.sol";

contract PirexCvxConvexTest is Test, HelperContract {
    event SetConvexContract(
        PirexCvxConvex.ConvexContract c,
        address contractAddress
    );
    event SetDelegationSpace(string _delegationSpace, bool shouldClear);
    event SetVoteDelegate(address voteDelegate);
    event ClearVoteDelegate();

    /**
        @notice Redeem CVX for the specified account and verify the subsequent balances
        @param  account     address  Account redeeming CVX
        @param  unlockTime  uint256  upxCVX token id
     */
    function _redeemCVX(address account, uint256 unlockTime) internal {
        uint256[] memory upxCvxIds = new uint256[](1);
        uint256[] memory redeemableAssets = new uint256[](1);

        upxCvxIds[0] = unlockTime;

        uint256 upxCvxBalanceBefore = upxCvx.balanceOf(account, upxCvxIds[0]);
        uint256 cvxBalanceBefore = CVX.balanceOf(account);

        redeemableAssets[0] = upxCvxBalanceBefore;

        vm.prank(account);
        pirexCvx.redeem(upxCvxIds, redeemableAssets, account);

        // upxCVX must be zero since we specified the balance when redeeming
        assertEq(upxCvx.balanceOf(account, upxCvxIds[0]), 0);

        // CVX balance must have increased by the amount of upxCVX burned as they are 1 to 1
        assertEq(
            CVX.balanceOf(account),
            cvxBalanceBefore + upxCvxBalanceBefore
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setConvexContract TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetConvexContractNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setConvexContract(
            PirexCvxConvex.ConvexContract.CvxLocker,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetConvexContractZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.setConvexContract(
            PirexCvxConvex.ConvexContract.CvxLocker,
            address(0)
        );
    }

    /**
        @notice Test setting CvxLocker
     */
    function testSetConvexContractCvxLocker() external {
        PirexCvxConvex.ConvexContract c = PirexCvxConvex
            .ConvexContract
            .CvxLocker;
        address oldContract = address(pirexCvx.cvxLocker());
        address newContract = address(this);

        vm.expectEmit(false, false, false, true);

        emit SetConvexContract(c, address(this));

        pirexCvx.setConvexContract(c, address(this));

        address updatedContract = address(pirexCvx.cvxLocker());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);

        // Check the allowances
        assertEq(CVX.allowance(address(pirexCvx), oldContract), 0);
        assertEq(
            CVX.allowance(address(pirexCvx), newContract),
            type(uint256).max
        );
    }

    /**
        @notice Test setting CvxDelegateRegistry
     */
    function testSetConvexContractCvxDelegateRegistry() external {
        PirexCvxConvex.ConvexContract c = PirexCvxConvex
            .ConvexContract
            .CvxDelegateRegistry;
        address oldContract = address(pirexCvx.cvxDelegateRegistry());
        address newContract = address(this);

        vm.expectEmit(false, false, false, true);

        emit SetConvexContract(c, address(this));

        pirexCvx.setConvexContract(c, address(this));

        address updatedContract = address(pirexCvx.cvxDelegateRegistry());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /*//////////////////////////////////////////////////////////////
                        lock TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if the contract is paused
     */
    function testCannotLockPaused() external {
        pirexCvx.setPauseState(true);

        assertEq(pirexCvx.paused(), true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.lock();
    }

    /**
        @notice Fuzz to verify only the correct amounts are locked and left unlocked
        @param  assets             uint256  CVX mint and deposit amount
        @param  redemptionAmount   uint256  CVX amount to be redeemed
        @param  pendingLockAmount  uint256  CVX amount deposited but not locked
     */
    function testLock(
        uint256 assets,
        uint256 redemptionAmount,
        uint256 pendingLockAmount
    ) external {
        // Need to ensure assets and redemption amounts are greater than the redemption fee min
        // The issue of errors from rounding down will be addressed in a new PR
        (, , uint32 redemptionMin, ) = pirexCvx.getFees();

        vm.assume(assets < 1000e18);
        vm.assume(assets > uint256(redemptionMin));
        vm.assume(redemptionAmount < assets);
        vm.assume(redemptionAmount > uint256(redemptionMin));
        vm.assume(pendingLockAmount != 0);
        vm.assume(pendingLockAmount < 1000e18);

        uint256 tLen = secondaryAccounts.length;

        // Warp to the next epoch
        vm.warp(pxCvx.getCurrentEpoch() + EPOCH_DURATION);

        for (uint256 i; i < tLen; ++i) {
            address secondaryAccount = secondaryAccounts[i];

            // Deposit and lock CVX so that there are locked balances to redeem against
            _mintAndDepositCVX(
                assets,
                secondaryAccount,
                false,
                address(0),
                true
            );

            uint256[] memory lockIndexes = new uint256[](1);
            uint256[] memory lockableAssets = new uint256[](1);

            lockIndexes[0] = i;
            lockableAssets[0] = redemptionAmount;

            vm.prank(secondaryAccount);
            pirexCvx.initiateRedemptions(
                lockIndexes,
                PirexCvx.Futures.Reward,
                lockableAssets,
                secondaryAccount
            );

            // Warp forward an epoch to lock and initiate redemptions in different timestamps/lock indexes
            vm.warp(block.timestamp + EPOCH_DURATION * (i + 1));
        }

        (, , , CvxLockerV2.LockedBalance[] memory lockData) = CVX_LOCKER
            .lockedBalances(address(pirexCvx));
        uint256 lockLen = lockData.length;

        // The minimum amount of CVX that must remain unlocked (excluding pending locks) to fulfill redemptions
        // Different from `outstandingRedemptions` which is the maximum amount
        uint256 minimumCvxBalanceRequired;

        // Check that `_lock` handles pendingLocks and outstandingRedemptions
        for (uint256 i; i < lockLen; ++i) {
            // Warp to the unlock timestamp to test that the necessary balances are locked and/or unlocked
            vm.warp(lockData[i].unlockTime);

            address secondaryAccount = secondaryAccounts[i];
            (, uint256 unlockable, , ) = CVX_LOCKER.lockedBalances(
                address(pirexCvx)
            );

            // Increment by the user's upxCVX balance to track the amount of CVX that must be present in the contract
            minimumCvxBalanceRequired += upxCvx.balanceOf(
                secondaryAccount,
                lockData[i].unlockTime
            );

            // Deposit CVX without immediately locking to ensure `pendingLocks` is non-zero for test
            _mintAndDepositCVX(
                pendingLockAmount,
                PRIMARY_ACCOUNT,
                false,
                address(0),
                false
            );

            uint256 pendingLocks = pirexCvx.getPendingLocks();
            uint256 outstandingRedemptions = pirexCvx
                .getOutstandingRedemptions();

            // Maximum amount of CVX that PirexCvx can have (balance and unlockable CVX deducted by pendingLocks)
            uint256 maxCvxBalance = CVX.balanceOf(address(pirexCvx)) +
                unlockable -
                pendingLocks;

            // Actual amount of CVX that PirexCvx should have (anything above outstandingRedemptions is locked)
            uint256 expectedCvxBalance = outstandingRedemptions > maxCvxBalance
                ? maxCvxBalance
                : outstandingRedemptions;
            uint256 lockedBefore = CVX_LOCKER.lockedBalanceOf(
                address(pirexCvx)
            );

            // Lock pendingLocks amount and any amount over outstandingRedemptions
            pirexCvx.lock();

            uint256 lockedAfter = CVX_LOCKER.lockedBalanceOf(address(pirexCvx));
            uint256 postLockCvxBalance = CVX.balanceOf(address(pirexCvx));

            // The post-lock balance must equal expected (i.e. always lock pendingLocks and amounts over outstanding)
            assertEq(postLockCvxBalance, expectedCvxBalance);

            // After accounting for unlocked amounts, the locked balance delta must be GTE to pendingLocks
            assertGe(lockedAfter, (lockedBefore - unlockable) + pendingLocks);

            // The expected (i.e. post-lock) balance must be GTE to the minimum required
            assertGe(expectedCvxBalance, minimumCvxBalanceRequired);

            // The post-lock balance must be LTE to what's necessary to fulfill redemptions
            assertLe(postLockCvxBalance, outstandingRedemptions);
        }

        // After checking that the appropriate amounts are locked or kept unlocked, verify that the CVX is redeemable
        for (uint256 i; i < lockLen; ++i) {
            _redeemCVX(secondaryAccounts[i], lockData[i].unlockTime);
        }
    }

    /*//////////////////////////////////////////////////////////////
                        setDelegationSpace TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetDelegationSpaceNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setDelegationSpace("space.eth", false);
    }

    /**
        @notice Test tx reversion if using empty string
     */
    function testCannotSetDelegationSpaceEmptyString() external {
        vm.expectRevert(PirexCvxConvex.EmptyString.selector);

        pirexCvx.setDelegationSpace("", false);
    }

    /**
        @notice Test setting delegation space without clearing
     */
    function testSetDelegationSpaceWithoutClearing() external {
        string memory space = "space.eth";

        vm.expectEmit(false, false, false, true);

        emit SetDelegationSpace(space, false);

        pirexCvx.setDelegationSpace(space, false);

        assertEq(pirexCvx.delegationSpace(), bytes32(bytes(space)));
    }

    /**
        @notice Test setting delegation space with clearing
     */
    function testSetDelegationSpaceWithClearing() external {
        string memory oldSpace = "old.eth";
        string memory newSpace = "new.eth";

        pirexCvx.setDelegationSpace(oldSpace, false);

        // Set the vote delegate before clearing it when setting new delegation space
        pirexCvx.setVoteDelegate(address(this));

        assertEq(pirexCvx.delegationSpace(), bytes32(bytes(oldSpace)));

        pirexCvx.setDelegationSpace(newSpace, true);

        assertEq(pirexCvx.delegationSpace(), bytes32(bytes(newSpace)));
    }

    /*//////////////////////////////////////////////////////////////
                        setVoteDelegate TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetVoteDelegateNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setVoteDelegate(address(this));
    }

    /**
        @notice Test tx reversion if using zero address as delegate
     */
    function testCannotSetVoteDelegateZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.setVoteDelegate(address(0));
    }

    /**
        @notice Test setting vote delegate
     */
    function testSetVoteDelegate() external {
        DelegateRegistry delegateRegistry = DelegateRegistry(
            CVX_DELEGATE_REGISTRY
        );
        address oldDelegate = delegateRegistry.delegation(
            address(pirexCvx),
            pirexCvx.delegationSpace()
        );
        address newDelegate = address(this);

        assertFalse(oldDelegate == newDelegate);

        vm.expectEmit(false, false, false, true);

        emit SetVoteDelegate(newDelegate);

        pirexCvx.setVoteDelegate(newDelegate);

        address delegate = delegateRegistry.delegation(
            address(pirexCvx),
            pirexCvx.delegationSpace()
        );

        assertEq(delegate, newDelegate);
    }

    /*//////////////////////////////////////////////////////////////
                        clearVoteDelegate TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotClearVoteDelegateNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.clearVoteDelegate();
    }

    /**
        @notice Test tx reversion if clearing without first setting delegate
     */
    function testCannotClearVoteDelegateNoDelegate() external {
        vm.expectRevert("No delegate set");

        pirexCvx.clearVoteDelegate();
    }

    /**
        @notice Test clearing vote delegate
     */
    function testClearVoteDelegate() external {
        pirexCvx.setDelegationSpace("space.eth", false);

        // Set the vote delegate before clearing it when setting new delegation space
        pirexCvx.setVoteDelegate(address(this));

        vm.expectEmit(false, false, false, true);

        emit ClearVoteDelegate();

        pirexCvx.clearVoteDelegate();

        assertEq(
            DelegateRegistry(CVX_DELEGATE_REGISTRY).delegation(
                address(pirexCvx),
                pirexCvx.delegationSpace()
            ),
            address(0)
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setPauseState TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetPauseStateNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setPauseState(true);
    }

    /**
        @notice Test tx reversion if unpausing when not paused
     */
    function testCannotSetPauseStateNotPaused() external {
        assertEq(pirexCvx.paused(), false);

        vm.expectRevert("Pausable: not paused");

        pirexCvx.setPauseState(false);
    }

    /**
        @notice Test tx reversion if pausing when paused
     */
    function testCannotSetPauseStatePaused() external {
        pirexCvx.setPauseState(true);

        assertEq(pirexCvx.paused(), true);

        vm.expectRevert("Pausable: paused");

        pirexCvx.setPauseState(true);
    }

    /**
        @notice Test setting pause state
     */
    function testSetPauseState() external {
        assertEq(pirexCvx.paused(), false);

        pirexCvx.setPauseState(true);

        assertEq(pirexCvx.paused(), true);

        pirexCvx.setPauseState(false);

        assertEq(pirexCvx.paused(), false);
    }

    /*//////////////////////////////////////////////////////////////
                        unlock TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotUnlockNotAuthorized() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.unlock();
    }

    /**
        @notice Test tx reversion if the contract is not paused
     */
    function testCannotUnlockNotPaused() external {
        vm.expectRevert("Pausable: not paused");

        pirexCvx.unlock();
    }

    /**
        @notice Test manually unlocking all available CVX
        @param  amount  uint72   Amount of assets
     */
    function testUnlock(uint72 amount) external {
        vm.assume(amount != 0);

        _mintAndDepositCVX(amount, address(this), false, address(0), true);

        assertEq(CVX.balanceOf(address(pirexCvx)), 0);

        // Shutdown CVX locker for the forced-unlock simulation
        vm.prank(CVX_LOCKER_OWNER);

        CVX_LOCKER.shutdown();

        pirexCvx.setPauseState(true);

        // Retrieve all unlocked/available CVX from the locker
        pirexCvx.unlock();

        assertEq(CVX.balanceOf(address(pirexCvx)), amount);
    }

    /*//////////////////////////////////////////////////////////////
                        pausedRelock TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotPausedRelockNotAuthorized() external {
        pirexCvx.setPauseState(true);

        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.pausedRelock();
    }

    /**
        @notice Test tx reversion if the contract is not paused
     */
    function testCannotPausedRelockNotPaused() external {
        vm.expectRevert("Pausable: not paused");

        pirexCvx.pausedRelock();
    }

    /**
        @notice Test manually relocking
        @param  amount  uint72   Amount of assets
     */
    function testPausedRelock(uint72 amount) external {
        vm.assume(amount != 0);

        // Simulate relocking by making a deposit without immediate locking
        // then manually lock by calling pausedRelock
        _mintAndDepositCVX(amount, address(this), false, address(0), false);

        assertEq(CVX.balanceOf(address(pirexCvx)), amount);

        pirexCvx.setPauseState(true);
        pirexCvx.pausedRelock();

        assertEq(CVX.balanceOf(address(pirexCvx)), 0);
        assertEq(CVX_LOCKER.lockedBalanceOf(address(pirexCvx)), amount);
    }
}
