// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;

    ERC20 public cvx;
    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));

    event SetCvx(address _cvx);
    event SetCvxLocker(address _cvxLocker);
    event SetCvxDelegateRegistry(address _cvxDelegateRegistry);
    event SetDelegationSpace(string _delegationSpace);
    event Deposit(address to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();

    /**
        @param  _cvx                     address     CVX address    
        @param  _cvxLocker               address     CvxLocker address
        @param  _cvxDelegateRegistry     address     CvxDelegateRegistry address
     */
    constructor(
        address _cvx,
        address _cvxLocker,
        address _cvxDelegateRegistry
    ) {
        if (_cvx == address(0)) revert ZeroAddress();
        cvx = ERC20(_cvx);

        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);
    }

    /** 
        @notice Set CVX token address
        @param  _cvx  address  CVX address    
     */
    function setCvx(address _cvx) external onlyOwner {
        if (_cvx == address(0)) revert ZeroAddress();
        cvx = ERC20(_cvx);

        emit SetCvx(_cvx);
    }

    /** 
        @notice Set CvxLocker address
        @param  _cvxLocker  address  CvxLocker address    
     */
    function setCvxLocker(address _cvxLocker) external onlyOwner {
        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        emit SetCvxLocker(_cvxLocker);
    }

    /** 
        @notice Set CvxDelegateRegistry address
        @param  _cvxDelegateRegistry  address  CvxDelegateRegistry address    
     */
    function setCvxDelegateRegistry(address _cvxDelegateRegistry)
        external
        onlyOwner
    {
        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);

        emit SetCvxDelegateRegistry(_cvxDelegateRegistry);
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
        @notice Lock CVX
        @param  amount  uint256  CVX amount
     */
    function _lock(uint256 amount) internal {
        cvxLocker.lock(address(this), amount, 0);
    }

    /**
        @notice Deposit CVX
        @param  to      address  Address receiving pCVX
        @param  amount  uint256  CVX amount
     */
    function deposit(address to, uint256 amount) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        // Mint pCVX
        _mint(to, amount);

        emit Deposit(to, amount);

        // Transfer vault underlying and approve amount to be deposited
        cvx.safeTransferFrom(msg.sender, address(this), amount);

        // Validates zero address
        cvx.safeIncreaseAllowance(address(cvxLocker), amount);

        // Lock CVX
        _lock(amount);
    }
}
