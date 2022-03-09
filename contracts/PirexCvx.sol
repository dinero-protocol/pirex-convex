// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC20PresetMinterPauserUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    struct Unlock {
        address token;
        uint256 lockExpiry;
    }

    // Users can choose between the two futures tokens when staking or unlocking
    enum Futures {
        Vote,
        Reward
    }

    // Configurable contracts
    enum Contract {
        CvxLocker,
        CvxDelegateRegistry,
        UpCvxImplementation,
        VpCvxImplementation,
        RpCvxImplementation
    }

    ERC20 public immutable CVX;

    // Time between Convex voting rounds
    uint256 public immutable EPOCH_DURATION = 2 weeks;

    // Number of futures rounds to mint when a redemption is initiated
    uint8 public immutable REDEMPTION_FUTURES_ROUNDS = 8;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;

    address public upCvxImplementation;
    address public vpCvxImplementation;
    address public rpCvxImplementation;
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));
    uint256 public cvxOutstanding;

    // Epochs mapped to minimal proxy addresses
    mapping(uint256 => Unlock) public upCvxByEpoch;
    mapping(uint256 => address) public vpCvxByEpoch;
    mapping(uint256 => address) public rpCvxByEpoch;

    // List of deployed minimal proxies
    uint256[] public upCvxEpochs;
    address[] public vpCvx;
    address[] public rpCvx;

    event SetContract(Contract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event CreateUpCvx(uint256 epoch, address contractAddress);
    event CreateFutures(uint256 epoch, address contractAddress);
    event MintFutures(
        uint256 epochCount,
        address indexed to,
        uint256 amount,
        Futures indexed f
    );
    event Deposit(address indexed to, uint256 amount);
    event InitiateRedemption(address indexed to, uint256 amount);
    event Redeem(uint256 indexed epoch, address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();
    error BeforeLockExpiry();

    /**
        @param  _CVX                  address  CVX address    
        @param  _cvxLocker            address  CvxLocker address
        @param  _cvxDelegateRegistry  address  CvxDelegateRegistry address
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

        upCvxImplementation = address(new ERC20PresetMinterPauserUpgradeable());
        vpCvxImplementation = address(new ERC20PresetMinterPauserUpgradeable());
        rpCvxImplementation = address(new ERC20PresetMinterPauserUpgradeable());
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

        if (c == Contract.VpCvxImplementation) {
            vpCvxImplementation = contractAddress;
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
        @notice Relock CVX
     */
    function relock() external {
        cvxLocker.processExpiredLocks(false, 0, address(this));

        uint256 balance = CVX.balanceOf(address(this));

        if (balance > cvxOutstanding) {
            unchecked {
                _lock(balance - cvxOutstanding);
            }
        }
    }

    /**
        @notice Create an UpCvx instance for the current epoch
        @return         address  UpCvx address
     */
    function _createUpCvx() internal returns (address) {
        uint256 currentEpoch = getCurrentEpoch();

        // Return contract address if it exists vs. inefficient revert
        if (upCvxByEpoch[currentEpoch].token != address(0))
            return upCvxByEpoch[currentEpoch].token;

        // Clone implementation and deploy minimal proxy
        address uAddr = Clones.clone(upCvxImplementation);
        upCvxByEpoch[currentEpoch] = Unlock({
            token: uAddr,
            lockExpiry: currentEpoch + 17 weeks
        });
        upCvxEpochs.push(currentEpoch);

        emit CreateUpCvx(currentEpoch, uAddr);

        ERC20PresetMinterPauserUpgradeable(uAddr).initialize(
            "Pirex CVX Unlocking",
            string(abi.encodePacked("upCVX-", currentEpoch.toString()))
        );

        return uAddr;
    }

    /**
        @notice Create a futures token for an epoch
        @param   epoch    uint256  Epoch
        @param   f        enum     Futures
        @return  address  rpCvx    address
     */
    function _createFutures(uint256 epoch, Futures f)
        internal
        returns (address)
    {
        bool isVote = f == Futures.Vote;
        address futuresAddr = isVote
            ? vpCvxByEpoch[epoch]
            : rpCvxByEpoch[epoch];

        if (futuresAddr != address(0)) return futuresAddr;

        futuresAddr = Clones.clone(
            isVote ? vpCvxImplementation : rpCvxImplementation
        );

        if (isVote) {
            vpCvxByEpoch[epoch] = futuresAddr;
            vpCvx.push(futuresAddr);
        } else {
            rpCvxByEpoch[epoch] = futuresAddr;
            rpCvx.push(futuresAddr);
        }

        emit CreateFutures(epoch, futuresAddr);

        ERC20PresetMinterPauserUpgradeable(futuresAddr).initialize(
            isVote ? "Pirex CVX Vote" : "Pirex CVX Reward",
            string(
                abi.encodePacked(isVote ? "vpCVX-" : "rpCVX-", epoch.toString())
            )
        );

        return futuresAddr;
    }

    /**
        @notice Mint futures tokens
        @param  rounds  uint8    Futures rounds (i.e. Convex voting rounds)
        @param  to      address  Futures recipient
        @param  amount  uint256  Futures amount
        @param  f       enum     Futures
    */
    function _mintFutures(
        uint8 rounds,
        address to,
        uint256 amount,
        Futures f
    ) internal {
        uint256 startingEpoch = getCurrentEpoch() + EPOCH_DURATION;

        unchecked {
            for (uint8 i; i < rounds; ++i) {
                // Validates `to`
                ERC20PresetMinterPauserUpgradeable(
                    _createFutures(startingEpoch + (i * EPOCH_DURATION), f)
                ).mint(to, amount);
            }
        }

        emit MintFutures(rounds, to, amount, f);
    }

    /**
        @notice Deposit CVX
        @param  to      address  Address receiving pCVX
        @param  amount  uint256  CVX amount
     */
    function deposit(address to, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Mint pCVX - validates `to`
        _mint(to, amount);

        emit Deposit(to, amount);

        // Transfer CVX to self and approve for locking
        CVX.safeTransferFrom(msg.sender, address(this), amount);
        CVX.safeIncreaseAllowance(address(cvxLocker), amount);

        // Lock CVX
        _lock(amount);
    }

    /**
        @notice Initiate CVX redemption
        @param  to       address  upCVX recipient
        @param  amount   uint256  pCVX/upCVX amount
        @param  f        enum     Futures
     */
    function initiateRedemption(
        address to,
        uint256 amount,
        Futures f
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        // Burn pCVX - validates `to`
        _burn(msg.sender, amount);

        // Track amount that needs to remain unlocked for redemptions
        cvxOutstanding += amount;

        emit InitiateRedemption(to, amount);

        // Mint upCVX associated with the current epoch
        ERC20PresetMinterPauserUpgradeable(_createUpCvx()).mint(to, amount);

        // Mint voteCVX or rewardCVX
        _mintFutures(REDEMPTION_FUTURES_ROUNDS, to, amount, f);
    }

    /**
        @notice Redeem CVX
        @param  epoch    uint256  Epoch
        @param  to       address  CVX recipient
        @param  amount   uint256  upCVX/CVX amount
     */
    function redeem(
        uint256 epoch,
        address to,
        uint256 amount
    ) external nonReentrant {
        if (upCvxByEpoch[epoch].lockExpiry > block.timestamp)
            revert BeforeLockExpiry();
        if (amount == 0) revert ZeroAmount();

        cvxOutstanding -= amount;

        emit Redeem(epoch, to, amount);

        // Validates `to`
        ERC20PresetMinterPauserUpgradeable(upCvxByEpoch[epoch].token).burnFrom(
            msg.sender,
            amount
        );

        // Validates `to`
        CVX.safeTransfer(to, amount);
    }
}
