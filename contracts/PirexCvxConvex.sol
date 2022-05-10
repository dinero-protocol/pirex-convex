// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";

contract PirexCvxConvex is AccessControl, Pausable {
    using SafeTransferLib for ERC20;

    /**
        @notice Convex reward details
        @param  token    address  Token
        @param  amount   uint256  Amount
        @param  balance  uint256  Balance (used for calculating the actual received amount)
     */
    struct ConvexReward {
        address token;
        uint256 amount;
        uint256 balance;
    }

    // Configurable contracts
    enum ConvexContract {
        CvxLocker,
        CvxDelegateRegistry
    }

    ERC20 public immutable CVX;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    // Convex Snapshot space
    bytes32 public delegationSpace = bytes32("cvx.eth");

    // The amount of CVX that needs to remain unlocked for redemptions
    uint256 public outstandingRedemptions;
    uint256 public pendingLocks;

    event SetConvexContract(ConvexContract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event SetVoteDelegate(address voteDelegate);
    event ClearVoteDelegate();

    error ZeroAddress();
    error EmptyString();

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry
    ) {
        if (_CVX == address(0)) revert ZeroAddress();
        CVX = ERC20(_CVX);

        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);

        // Max allowance for cvxLocker
        CVX.safeApprove(address(cvxLocker), type(uint256).max);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /** 
        @notice Set a contract address
        @param  c                enum     Contract enum
        @param  contractAddress  address  Contract address    
     */
    function setConvexContract(ConvexContract c, address contractAddress)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (contractAddress == address(0)) revert ZeroAddress();

        emit SetConvexContract(c, contractAddress);

        if (c == ConvexContract.CvxLocker) {
            // Revoke approval from the old locker and add allowances to the new locker
            CVX.safeApprove(address(cvxLocker), 0);
            cvxLocker = ICvxLocker(contractAddress);
            CVX.safeApprove(contractAddress, type(uint256).max);
            return;
        }

        if (c == ConvexContract.CvxDelegateRegistry) {
            cvxDelegateRegistry = ICvxDelegateRegistry(contractAddress);
            return;
        }
    }

    /**
        @notice Unlock CVX
     */
    function _unlock() internal {
        (, uint256 unlockable, , ) = cvxLocker.lockedBalances(address(this));

        if (unlockable != 0) cvxLocker.processExpiredLocks(false);
    }

    /**
        @notice Unlock CVX and relock excess
     */
    function _lock() internal {
        _unlock();

        uint256 balance = CVX.balanceOf(address(this));
        bool balanceGreaterThanRedemptions = balance > outstandingRedemptions;

        // Lock CVX if the balance is greater than outstanding redemptions or if there are pending locks
        if (balanceGreaterThanRedemptions || pendingLocks != 0) {
            uint256 balanceRedemptionsDifference = balanceGreaterThanRedemptions
                ? balance - outstandingRedemptions
                : 0;

            // Lock amount is the greater of the two: balanceRedemptionsDifference or pendingLocks
            // balanceRedemptionsDifference is greater if there is unlocked CVX that isn't reserved for redemptions + deposits
            // pendingLocks is greater if there are more new deposits than unlocked CVX that is reserved for redemptions
            cvxLocker.lock(
                address(this),
                balanceRedemptionsDifference > pendingLocks
                    ? balanceRedemptionsDifference
                    : pendingLocks,
                0
            );

            pendingLocks = 0;
        }
    }

    /**
        @notice Non-permissioned relock method
     */
    function lock() external whenNotPaused {
        _lock();
    }

    /**
        @notice Get claimable rewards and balances
        @return rewards  ConvexReward[]  Claimable rewards and balances
     */
    function _claimableRewards()
        internal
        view
        returns (ConvexReward[] memory rewards)
    {
        address addr = address(this);

        // Get claimable rewards
        ICvxLocker.EarnedData[] memory c = cvxLocker.claimableRewards(addr);

        uint256 cLen = c.length;
        rewards = new ConvexReward[](cLen);

        // Get the current balances for each token to calculate the amount received
        for (uint256 i; i < cLen; ++i) {
            rewards[i] = ConvexReward({
                token: c[i].token,
                amount: c[i].amount,
                balance: ERC20(c[i].token).balanceOf(addr)
            });
        }
    }

    /** 
        @notice Claim Convex rewards
     */
    function _getReward() internal {
        // Claim rewards from Convex
        cvxLocker.getReward(address(this), false);
    }

    /** 
        @notice Set delegationSpace
        @param  _delegationSpace  string  Convex Snapshot delegation space
     */
    function setDelegationSpace(string memory _delegationSpace)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        bytes memory d = bytes(_delegationSpace);
        if (d.length == 0) revert EmptyString();
        delegationSpace = bytes32(d);

        emit SetDelegationSpace(_delegationSpace);
    }

    /**
        @notice Set vote delegate
        @param  voteDelegate  address  Account to delegate votes to
     */
    function setVoteDelegate(address voteDelegate)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (voteDelegate == address(0)) revert ZeroAddress();

        emit SetVoteDelegate(voteDelegate);

        cvxDelegateRegistry.setDelegate(delegationSpace, voteDelegate);
    }

    /**
        @notice Remove vote delegate
     */
    function clearVoteDelegate() external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit ClearVoteDelegate();

        cvxDelegateRegistry.clearDelegate(delegationSpace);
    }

    /*//////////////////////////////////////////////////////////////
                        EMERGENCY/MIGRATION LOGIC
    //////////////////////////////////////////////////////////////*/

    /** 
        @notice Set the contract's pause state
        @param state  bool  Pause state
    */
    function setPauseState(bool state) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (state) {
            _pause();
        } else {
            _unpause();
        }
    }

    /**
        @notice Unlock CVX and prepare for migration (e.g. in the event of a mass CVX unlock)
     */
    function unlock() external whenPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        _unlock();
    }

    /**
        @notice Relock CVX with a new CvxLocker contract (if possible)
     */
    function pausedRelock() external whenPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        _lock();
    }
}
