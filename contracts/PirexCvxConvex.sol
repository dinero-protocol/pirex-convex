// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";
import {ICvxRewardPool} from "./interfaces/ICvxRewardPool.sol";

contract PirexCvxConvex is Ownable {
    using SafeERC20 for ERC20;

    struct ConvexReward {
        address token;
        uint256 amount;
        uint256 balance;
    }

    struct ConvexLock {
        uint256 amount;
        uint256 unlockTime;
    }

    // Configurable contracts
    enum ConvexContract {
        CvxLocker,
        CvxDelegateRegistry,
        CvxRewardPool,
        CvxCrvToken
    }

    ERC20 public immutable CVX;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;
    ICvxRewardPool public cvxRewardPool;
    ERC20 public cvxCRV;

    // Convex Snapshot space
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));

    // Protocol-owned EOA that is delegated vlCVX votes
    address public voteDelegate;

    // The amount of CVX that needs to remain unlocked for redemptions
    uint256 public outstandingRedemptions;

    event SetConvexContract(ConvexContract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event SetVoteDelegate(address _voteDelegate);
    event ClearVoteDelegate();

    error ZeroAddress();
    error EmptyString();

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
        @param  _cvxRewardPool           address  CvxRewardPool address
        @param  _cvxCRV                  address  CvxCrvToken address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _cvxRewardPool,
        address _cvxCRV
    ) {
        if (_CVX == address(0)) revert ZeroAddress();
        CVX = ERC20(_CVX);

        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);

        if (_cvxRewardPool == address(0)) revert ZeroAddress();
        cvxRewardPool = ICvxRewardPool(_cvxRewardPool);

        if (_cvxCRV == address(0)) revert ZeroAddress();
        cvxCRV = ERC20(_cvxCRV);
    }

    /** 
        @notice Set a contract address
        @param  c                ConvexContract  Contract to set
        @param  contractAddress  address         CvxLocker address    
     */
    function setConvexContract(ConvexContract c, address contractAddress)
        external
        onlyOwner
    {
        if (contractAddress == address(0)) revert ZeroAddress();

        emit SetConvexContract(c, contractAddress);

        if (c == ConvexContract.CvxLocker) {
            cvxLocker = ICvxLocker(contractAddress);
            return;
        }

        if (c == ConvexContract.CvxDelegateRegistry) {
            cvxDelegateRegistry = ICvxDelegateRegistry(contractAddress);
            return;
        }

        if (c == ConvexContract.CvxRewardPool) {
            cvxRewardPool = ICvxRewardPool(contractAddress);
            return;
        }

        cvxCRV = ERC20(contractAddress);
    }

    /**
        @notice Lock CVX
        @param  amount  uint256  CVX amount
     */
    function _lock(uint256 amount) internal {
        CVX.safeIncreaseAllowance(address(cvxLocker), amount);
        cvxLocker.lock(address(this), amount, 0);
    }

    /**
        @notice Unlock CVX
     */
    function _unlock() internal {
        (, uint256 unlockable, , ) = cvxLocker.lockedBalances(address(this));

        if (unlockable != 0)
            cvxLocker.processExpiredLocks(false, 0, address(this));
    }

    /**
        @notice Unlock CVX and relock excess
     */
    function _relock() internal {
        _unlock();

        uint256 balance = CVX.balanceOf(address(this));

        if (balance > outstandingRedemptions) {
            unchecked {
                _lock(balance - outstandingRedemptions);
            }
        }
    }

    /**
        @notice Get claimable rewards and balances
        @return  rewards  ConvexReward[]  Claimable rewards and balances
     */
    function _claimableRewards()
        internal
        view
        returns (ConvexReward[] memory rewards)
    {
        address addr = address(this);

        // Get claimable rewards
        ICvxLocker.EarnedData[] memory c = cvxLocker.claimableRewards(addr);

        uint8 cLen = uint8(c.length);
        rewards = new ConvexReward[](cLen);

        // Get the current balances for each token to calculate the amount received
        for (uint8 i; i < cLen; ++i) {
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
        @notice Get Convex lock data at a specific index
        @param  lockIndex   uint256  Lock data index
        @return amount      uint256  CVX amount
        @return unlockTime  uint256  CVX unlock time
     */
    function _getLockData(uint256 lockIndex)
        internal
        view
        returns (uint256 amount, uint256 unlockTime)
    {
        (, , , ICvxLocker.LockedBalance[] memory lockData) = cvxLocker
            .lockedBalances(address(this));

        return (lockData[lockIndex].amount, lockData[lockIndex].unlockTime);
    }

    /** 
        @notice Set delegationSpace
        @param  _delegationSpace  string  Convex Snapshot delegation space
     */
    function setDelegationSpace(string memory _delegationSpace)
        external
        onlyOwner
    {
        bytes memory d = bytes(_delegationSpace);
        if (d.length == 0) revert EmptyString();
        delegationSpace = bytes32(d);

        emit SetDelegationSpace(_delegationSpace);
    }

    /**
        @notice Set vote delegate
        @param  _voteDelegate  address  Account to delegate votes to
     */
    function setVoteDelegate(address _voteDelegate) external onlyOwner {
        if (_voteDelegate == address(0)) revert ZeroAddress();
        voteDelegate = _voteDelegate;

        emit SetVoteDelegate(_voteDelegate);

        cvxDelegateRegistry.setDelegate(delegationSpace, _voteDelegate);
    }

    /**
        @notice Remove vote delegate
     */
    function clearVoteDelegate() external onlyOwner {
        voteDelegate = address(0);

        emit ClearVoteDelegate();

        cvxDelegateRegistry.clearDelegate(delegationSpace);
    }
}
