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
import {RpCvx} from "./RpCvx.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;

    enum Futures {
        Vote,
        Reward
    }

    enum Contract {
        CvxLocker,
        CvxDelegateRegistry,
        UpCvxImplementation,
        RpCvxImplementation
    }

    ERC20 public immutable CVX;
    uint256 public immutable EPOCH_DURATION = 2 weeks;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    address public upCvxImplementation;
    address public rpCvxImplementation;
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));
    uint256 public cvxOutstanding;

    // Epochs mapped to minimal proxy addresses
    mapping(uint256 => address) public upCvxByEpoch;
    mapping(uint256 => address) public rpCvxByEpoch;

    // List of deployed minimal proxies
    address[] public upCvx;
    address[] public rpCvx;

    event SetContract(Contract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event Deposit(address indexed to, uint256 amount);
    event CreatedUpCvx(uint256 epoch, address contractAddress);
    event CreatedRpCvx(uint256 epoch, address contractAddress);
    event InitiateRedemption(
        uint256 indexed epoch,
        address indexed to,
        uint256 amount
    );

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();
    error ContractAlreadyExists();

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
        rpCvxImplementation = address(new RpCvx());
    }

    /** 
        @notice Set CvxLocker address
        @param  c                Contract  Contract to set
        @param  contractAddress  address   CvxLocker address    
     */
    function setContract(Contract c, address contractAddress)
        external
        onlyOwner
    {
        if (contractAddress == address(0)) revert ZeroAddress();

        emit SetContract(c, contractAddress);

        if (c == Contract.CvxLocker) {
            cvxLocker = ICvxLocker(contractAddress);
            return;
        }

        if (c == Contract.CvxDelegateRegistry) {
            cvxDelegateRegistry = ICvxDelegateRegistry(contractAddress);
            return;
        }

        if (c == Contract.UpCvxImplementation) {
            upCvxImplementation = contractAddress;
            return;
        }

        if (c == Contract.RpCvxImplementation) {
            rpCvxImplementation = contractAddress;
            return;
        }
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
        if (upCvxByEpoch[epoch] != address(0)) revert ContractAlreadyExists();

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
        @param  to       address  upCVX recipient
        @param  amount   uint256  pCVX amount
        @param  f        Futures   Future-settled asset
     */
    function initiateRedemption(
        address to,
        uint256 amount,
        Futures f
    ) external nonReentrant {
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
        if (f == Futures.Vote) {} else {}
    }
}
