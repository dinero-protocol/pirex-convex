// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";
import {UpCvx} from "./UpCvx.sol";
import {FuturesCvx} from "./FuturesCvx.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    enum Futures {
        Vote,
        Reward
    }

    enum Contract {
        CvxLocker,
        CvxDelegateRegistry,
        UpCvxImplementation,
        RpCvxImplementation,
        VpCvxImplementation
    }

    ERC20 public immutable CVX;
    uint256 public immutable EPOCH_DURATION = 2 weeks;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    address public upCvxImplementation;
    address public rpCvxImplementation;
    address public vpCvxImplementation;
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));
    uint256 public cvxOutstanding;

    // Epochs mapped to minimal proxy addresses
    mapping(uint256 => address) public upCvxByEpoch;
    mapping(uint256 => address) public rpCvxByEpoch;
    mapping(uint256 => address) public vpCvxByEpoch;

    // List of deployed minimal proxies
    address[] public upCvx;
    address[] public rpCvx;
    address[] public vpCvx;

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
    event SetUpRedemptionContracts(
        uint256 epoch,
        address _upCvx,
        address[8] _rpCvx
    );

    error ZeroAddress();
    error ZeroAmount();
    error ZeroEpoch();
    error EmptyString();
    error AfterMintDeadline(uint256 epoch);

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
        rpCvxImplementation = address(new FuturesCvx());
        vpCvxImplementation = address(new FuturesCvx());
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

        if (c == Contract.VpCvxImplementation) {
            vpCvxImplementation = contractAddress;
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
        // Return contract address if it exists vs. inefficient revert
        if (upCvxByEpoch[epoch] != address(0)) return upCvxByEpoch[epoch];

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
        @notice Create a rpCVX token for an epoch
        @param   epoch    uint256  Epoch
        @return  address  rpCvx    address
     */
    function _createRpCvx(uint256 epoch) internal returns (address) {
        if (rpCvxByEpoch[epoch] != address(0)) return rpCvxByEpoch[epoch];

        address r = Clones.clone(rpCvxImplementation);
        rpCvxByEpoch[epoch] = r;
        rpCvx.push(r);

        emit CreatedRpCvx(epoch, r);

        FuturesCvx(r).initialize(
            epoch,
            "Pirex CVX Reward",
            string(abi.encodePacked("rpCVX-", epoch.toString()))
        );

        return r;
    }

    /**
        @notice Set up contracts for a redemption
        @param   epoch                uint256     Epoch
        @return  _upCvx               address     UpCvx address
        @return  _rpCvx               address[8]  rpCVX addresses
    */
    function _setUpRedemptionContracts(uint256 epoch)
        internal
        returns (address _upCvx, address[8] memory _rpCvx)
    {
        if (epoch == 0) revert ZeroEpoch();

        // Create an UpCvx instance for the epoch if it doesn't exist
        _upCvx = _createUpCvx(epoch);

        unchecked {
            // Use the next epoch as a starting point for rpCVX since voting
            // or rewards don't start until after the UpCvx mint deadline
            uint256 startingEpoch = epoch + EPOCH_DURATION;

            // Create futures contracts for 8 Convex voting rounds
            for (uint8 i; i < 8; ++i) {
                _rpCvx[i] = _createRpCvx(startingEpoch + (i * EPOCH_DURATION));
            }
        }

        emit SetUpRedemptionContracts(epoch, _upCvx, _rpCvx);
    }

    /**
        @notice Mint pre-settled futures tokens
        @param  startingEpoch  uint256  Epoch to start minting tokens
        @param  to             address  Account receiving tokens
        @param  amount         uint256  Amount tokens to mint
        @param  f              Futures  Enum
    */
    function _mintFutures(
        uint256 startingEpoch,
        address to,
        uint256 amount,
        Futures f
    ) internal {
        if (startingEpoch == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        unchecked {
            for (uint8 i; i < 8; ++i) {
                FuturesCvx(rpCvxByEpoch[startingEpoch + (i * EPOCH_DURATION)])
                    .mint(to, amount);
            }
        }
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
        @param  f        Futures  Enum
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

        uint256 currentEpoch = getCurrentEpoch();

        emit InitiateRedemption(currentEpoch, to, amount);

        // Deploy new instance upCVX
        if (upCvxByEpoch[currentEpoch] == address(0)) {
            _setUpRedemptionContracts(currentEpoch);
        }

        // Mint upCVX
        UpCvx(upCvxByEpoch[currentEpoch]).mint(to, amount);

        // Mint voteCVX or rewardCVX
        _mintFutures(currentEpoch + EPOCH_DURATION, to, amount, f);
    }
}
