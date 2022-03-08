// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";
import {UpCvx} from "./UpCvx.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;

    ERC20 public immutable CVX;
    uint256 public immutable EPOCH_DURATION = 2 weeks;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    address public upCvxImplementation;
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));
    uint256 public cvxOutstanding;

    // Epochs mapped to UpCvx addresses
    mapping(uint256 => address) public upCvxByEpoch;

    // List of deployed UpCvx instances
    address[] public upCvx;

    event SetCvxLocker(address _cvxLocker);
    event SetCvxDelegateRegistry(address _cvxDelegateRegistry);
    event SetDelegationSpace(string _delegationSpace);
    event SetUpCvxImplementation(address _upCvxImplementation);
    event Deposit(address indexed to, uint256 amount);
    event CreatedUpCvx(uint256 epoch, address instance);
    event InitiateRedemption(uint256 indexed epoch, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();
    error InstanceAlreadyExists();

    /**
        @param  _CVX                     address     CVX address    
        @param  _cvxLocker               address     CvxLocker address
        @param  _cvxDelegateRegistry     address     CvxDelegateRegistry address
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

        upCvxImplementation = address(new UpCvx());
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
        @notice Set UpCvx
        @param  _upCvxImplementation  address  UpCvx implementation address
     */
    function setUpCvxImplementation(address _upCvxImplementation)
        external
        onlyOwner
    {
        if (_upCvxImplementation == address(0)) revert ZeroAddress();
        upCvxImplementation = _upCvxImplementation;

        emit SetUpCvxImplementation(_upCvxImplementation);
    }

    /**
        @notice Get current epoch
        @return uint256 Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp / EPOCH_DURATION) * EPOCH_DURATION;
    }

    /**
        @notice Lock CVX
        @param  amount  uint256  CVX amount
     */
    function _lock(uint256 amount) internal {
        cvxLocker.lock(address(this), amount, 0);
    }

    /**
        @notice Create an UpCvx instance for an epoch
        @param   epoch  uint256  Epoch
        @return         address  UpCvx address
     */
    function _createUpCvx(uint256 epoch) internal returns (address) {
        if (upCvxByEpoch[epoch] != address(0)) revert InstanceAlreadyExists();

        // Clone implementation and deploy minimal proxy
        UpCvx u = UpCvx(Clones.clone(upCvxImplementation));
        address uAddr = address(u);
        upCvxByEpoch[epoch] = uAddr;
        upCvx.push(uAddr);

        emit CreatedUpCvx(epoch, uAddr);

        u.initialize(epoch, address(CVX), address(this));

        return uAddr;
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
        CVX.safeTransferFrom(msg.sender, address(this), amount);

        // Validates zero address
        CVX.safeIncreaseAllowance(address(cvxLocker), amount);

        // Lock CVX
        _lock(amount);
    }

    /**
        @notice Initiate CVX redemption
        @param  to      address  upCVX recipient
        @param  amount  uint256  pCVX amount
     */
    function initiateRedemption(address to, uint256 amount)
        external
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();

        // Burn pCVX - validates `to`
        _burn(msg.sender, amount);

        // Track amount
        cvxOutstanding += amount;

        // Deploy new instance upCVX
        uint256 currentEpoch = getCurrentEpoch();

        emit InitiateRedemption(currentEpoch, to, amount);

        UpCvx u = UpCvx(upCvxByEpoch[currentEpoch]);
        if (address(u) == address(0)) {
            u = UpCvx(_createUpCvx(currentEpoch));
        }

        // Mint upCVX
        u.mint(to, amount);

        // Mint voteCVX or rewardCVX
    }
}
