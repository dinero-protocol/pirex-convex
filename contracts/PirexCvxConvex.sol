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

    // Configurable contracts
    enum ConvexContract {
        CvxLocker,
        CvxDelegateRegistry,
        CvxRewardPool
    }

    ERC20 public immutable CVX;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;
    ICvxRewardPool public cvxRewardPool;

    // Convex Snapshot space
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));

    // Protocol-owned EOA that is delegated vlCVX votes
    address public voteDelegate;

    // The amount of CVX that needs to remain unlocked for redemptions
    uint256 public cvxOutstanding;

    event SetConvexContract(ConvexContract c, address contractAddress);
    event StakeCvx(uint256 amount);
    event UnstakeCvx(uint256 amount);
    event SetDelegationSpace(string _delegationSpace);
    event SetVoteDelegate(address _voteDelegate);
    event ClearVoteDelegate();

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
        @param  _cvxRewardPool           address  CvxRewardPool address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _cvxRewardPool
    ) {
        if (_CVX == address(0)) revert ZeroAddress();
        CVX = ERC20(_CVX);

        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);

        if (_cvxRewardPool == address(0)) revert ZeroAddress();
        cvxRewardPool = ICvxRewardPool(_cvxRewardPool);
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

        cvxRewardPool = ICvxRewardPool(contractAddress);
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

        if (balance > cvxOutstanding) {
            unchecked {
                _lock(balance - cvxOutstanding);
            }
        }
    }

    /**
        @notice Stake CVX
        @param  amount  uint256  Amount of CVX to stake
     */
    function _stake(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();

        emit StakeCvx(amount);

        CVX.safeIncreaseAllowance(address(cvxRewardPool), amount);
        cvxRewardPool.stake(amount);
    }

    /**
        @notice Unstake CVX
        @param  amount  uint256  Amount of CVX to unstake
     */
    function _unstake(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();

        emit UnstakeCvx(amount);

        cvxRewardPool.withdraw(amount, false);
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
        
        uint256 cLen = c.length;
        rewards = new ConvexReward[](cLen);

        // Get the current balances for each token to calculate the amount received
        for (uint8 i; i < cLen; ++i) {
            if (c[i].amount == 0) continue;

            rewards[i] = ConvexReward({
                token: c[i].token,
                amount: c[i].amount,
                balance: ERC20(c[i].token).balanceOf(addr)
            });
        }
    }

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