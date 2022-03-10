// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC1155PresetMinterPauser} from "@openzeppelin/contracts/token/ERC1155/presets/ERC1155PresetMinterPauser.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";
import {StakedPirexCvx} from "./StakedPirexCvx.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20("Pirex CVX", "pCVX") {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    // Users can choose between the two futures tokens when staking or unlocking
    enum Futures {
        Vote,
        Reward
    }

    // Configurable contracts
    enum Contract {
        CvxLocker,
        CvxDelegateRegistry,
        UpCvx,
        VpCvx,
        RpCvx,
        SpCvxImplementation
    }

    ERC20 public immutable CVX;

    // Seconds between Convex voting rounds (2 weeks)
    uint32 public immutable EPOCH_DURATION = 1209600;

    // Seconds before upCVX can be redeemed for CVX (17 weeks)
    uint32 public immutable UNLOCKING_DURATION = 10281600;

    // Number of futures rounds to mint when a redemption is initiated
    uint8 public immutable REDEMPTION_FUTURES_ROUNDS = 8;

    ICvxLocker public cvxLocker;
    ICvxDelegateRegistry public cvxDelegateRegistry;
    ERC1155PresetMinterPauser public upCvx;
    ERC1155PresetMinterPauser public vpCvx;
    ERC1155PresetMinterPauser public rpCvx;

    // Staked Pirex CVX implementation
    address public spCvxImplementation;
    address[] public spCvx;

    // Convex Snapshot space
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));

    // The amount of CVX that needs to remain unlocked for redemptions
    uint256 public cvxOutstanding;

    event SetContract(Contract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event CreateSpCvx(address contractAddress);
    event MintFutures(
        uint8 rounds,
        address indexed to,
        uint256 amount,
        Futures indexed f
    );
    event Deposit(address indexed to, uint256 amount);
    event InitiateRedemption(address indexed to, uint256 amount);
    event Redeem(uint256 indexed epoch, address indexed to, uint256 amount);
    event Stake(
        uint8 rounds,
        address indexed to,
        uint256 amount,
        Futures indexed f,
        address vault
    );
    event Unstake(
        address vault,
        address indexed to,
        uint256 amount
    );

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();
    error BeforeLockExpiry();
    error InsufficientBalance();

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

        upCvx = new ERC1155PresetMinterPauser("");
        vpCvx = new ERC1155PresetMinterPauser("");
        rpCvx = new ERC1155PresetMinterPauser("");
        spCvxImplementation = address(new StakedPirexCvx());
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

        if (c == Contract.UpCvx) {
            upCvx = ERC1155PresetMinterPauser(contractAddress);
            return;
        }

        if (c == Contract.VpCvx) {
            vpCvx = ERC1155PresetMinterPauser(contractAddress);
            return;
        }

        if (c == Contract.RpCvx) {
            rpCvx = ERC1155PresetMinterPauser(contractAddress);
            return;
        }

        if (c == Contract.SpCvxImplementation) {
            spCvxImplementation = contractAddress;
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
        @return uint256  Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp / EPOCH_DURATION) * EPOCH_DURATION;
    }

    /**
        @notice Get spCvx array
        @return address  StakedPirexCvx vault address
     */
    function getSpCvx() external view returns (address[] memory) {
        return spCvx;
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
        @notice Mint futures tokens
        @param  rounds  uint8    Rounds (i.e. Convex voting rounds)
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
        address token = f == Futures.Vote ? address(vpCvx) : address(rpCvx);

        emit MintFutures(rounds, to, amount, f);

        unchecked {
            for (uint8 i; i < rounds; ++i) {
                // Validates `to`
                ERC1155PresetMinterPauser(token).mint(
                    to,
                    startingEpoch + i * EPOCH_DURATION,
                    amount,
                    ""
                );
            }
        }
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

        // Mint upCVX associated with the current epoch - validates `to`
        upCvx.mint(to, getCurrentEpoch(), amount, "");

        // Mint vpCVX or rpCVX
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
        // Revert if token cannot be unlocked yet
        if (epoch + UNLOCKING_DURATION > block.timestamp)
            revert BeforeLockExpiry();
        if (amount == 0) revert ZeroAmount();

        emit Redeem(epoch, to, amount);

        // Unlock and relock if balance is greater than cvxOutstanding
        _relock();

        // Subtract redemption amount from outstanding CVX amount
        cvxOutstanding -= amount;

        // Validates `to`
        upCvx.burn(msg.sender, epoch, amount);

        // Validates `to`
        CVX.safeTransfer(to, amount);
    }

    /**
        @notice Stake pCVX
        @param  rounds  uint8    Rounds (i.e. Convex voting rounds)
        @param  to      address  spCVX recipient
        @param  amount  uint256  pCVX/spCVX amount
        @param  f       enum     Futures
    */
    function stake(
        uint8 rounds,
        address to,
        uint256 amount,
        Futures f
    ) external nonReentrant {
        if (rounds == 0) revert ZeroAmount();
        if (amount == 0) revert ZeroAmount();

        // Deploy new vault dedicated to this staking position
        StakedPirexCvx s = StakedPirexCvx(Clones.clone(spCvxImplementation));
        address sAddr = address(s);

        // Maintain a record of vault
        spCvx.push(sAddr);

        // Transfer pCVX to self
        _transfer(msg.sender, address(this), amount);

        // Approve vault to transfer pCVX for deposit
        _approve(address(this), sAddr, amount);

        emit Stake(rounds, to, amount, f, sAddr);

        s.initialize(
            getCurrentEpoch() + rounds * EPOCH_DURATION,
            this,
            "Pirex CVX Staked",
            "spCVX"
        );

        // Transfer pCVX to vault and mint shares for `to`
        s.deposit(to, amount);

        _mintFutures(rounds, to, amount, f);
    }

    /**
        @notice Unstake pCVX
        @param  vault   address  StakedPirexCvx vault
        @param  to      address  pCVX recipient
        @param  amount  uint256  pCVX/spCVX amount
    */
    function unstake(
        address vault,
        address to,
        uint256 amount
    ) external nonReentrant {
        if (vault == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        StakedPirexCvx s = StakedPirexCvx(vault);

        emit Unstake(vault, to, amount);

        // Transfer shares from msg.sender to self
        ERC20(address(s)).safeTransferFrom(msg.sender, address(this), amount);

        // Burn upCVX and transfer pCVX to `to`
        s.redeem(to, amount);
    }
}
