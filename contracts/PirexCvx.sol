// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20Snapshot} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ERC1155PresetMinterSupply} from "./ERC1155PresetMinterSupply.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {ICvxDelegateRegistry} from "./interfaces/ICvxDelegateRegistry.sol";
import {IVotiumMultiMerkleStash} from "./interfaces/IVotiumMultiMerkleStash.sol";
import {StakedPirexCvx} from "./StakedPirexCvx.sol";

interface IConvexDelegateRegistry {
    function setDelegate(bytes32 id, address delegate) external;
}

contract PirexCvx is Ownable, ReentrancyGuard, ERC20Snapshot {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    /**
        @notice Epoch rewards for pCVX holders
        @param  amounts  uint256[]  Token amounts
        @param  claimed       mapping    Accounts mapped to tokens mapped to claimed amounts
     */
    struct SnapshotRewards {
        uint256[] amounts;
        mapping(address => mapping(address => uint256)) claimed;
    }

    /**
        @notice Epoch rewards for rpCVX holders
        @param  amounts  uint256[]  Token amounts
     */
    struct FuturesRewards {
        uint256[] amounts;
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
    IVotiumMultiMerkleStash public votiumMultiMerkleStash;
    ERC1155PresetMinterSupply public upCvx;
    ERC1155PresetMinterSupply public vpCvx;
    ERC1155PresetMinterSupply public rpCvx;

    // Staked Pirex CVX implementation
    address public spCvxImplementation;
    address[] public spCvx;

    // Convex Snapshot space
    bytes32 public delegationSpace = bytes32(bytes("cvx.eth"));

    // Protocol-owned EOA that is delegated vlCVX votes
    address public voteDelegate;

    // The amount of CVX that needs to remain unlocked for redemptions
    uint256 public cvxOutstanding;

    // Epochs mapped to snapshot ids
    mapping(uint256 => uint256) public epochSnapshotIds;

    // Epochs mapped to reward tokens - reward indexes must line up with
    // that of the indexes for snapshot and futures reward amounts
    mapping(uint256 => address[]) public rewards;

    // Epochs mapped to snapshot rewards
    mapping(uint256 => SnapshotRewards) snapshotRewards;

    // Epochs mapped to futures rewards
    mapping(uint256 => FuturesRewards) futuresRewards;

    event SetContract(Contract c, address contractAddress);
    event SetDelegationSpace(string _delegationSpace);
    event SetVoteDelegate(address _voteDelegate);
    event RemoveVoteDelegate();
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
    event Unstake(address vault, address indexed to, uint256 amount);
    event ClaimVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        uint256 snapshotId
    );
    event ClaimSnapshotReward(
        uint256 epoch,
        uint256 rewardIndex,
        address to,
        uint256 snapshotId,
        uint256 snapshotBalance,
        address reward,
        uint256 claimAmount
    );
    event ClaimFuturesRewards(
        uint256 epoch,
        address to,
        address[] rewards
    );

    error ZeroAddress();
    error ZeroAmount();
    error EmptyString();
    error BeforeLockExpiry();
    error InsufficientBalance();
    error AlreadyClaimed();

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
        @param  _votiumMultiMerkleStash  address  VotiumMultiMerkleStash address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _votiumMultiMerkleStash
    ) ERC20("Pirex CVX", "pCVX") {
        // Start snapshot id from 1 and set it to simplify snapshot-taking determination
        epochSnapshotIds[getCurrentEpoch()] = _snapshot();

        if (_CVX == address(0)) revert ZeroAddress();
        CVX = ERC20(_CVX);

        if (_cvxLocker == address(0)) revert ZeroAddress();
        cvxLocker = ICvxLocker(_cvxLocker);

        if (_cvxDelegateRegistry == address(0)) revert ZeroAddress();
        cvxDelegateRegistry = ICvxDelegateRegistry(_cvxDelegateRegistry);

        if (_votiumMultiMerkleStash == address(0)) revert ZeroAddress();
        votiumMultiMerkleStash = IVotiumMultiMerkleStash(
            _votiumMultiMerkleStash
        );

        upCvx = new ERC1155PresetMinterSupply("");
        vpCvx = new ERC1155PresetMinterSupply("");
        rpCvx = new ERC1155PresetMinterSupply("");
        spCvxImplementation = address(new StakedPirexCvx());
    }

    /** 
        @notice Set a contract address
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
            upCvx = ERC1155PresetMinterSupply(contractAddress);
            return;
        }

        if (c == Contract.VpCvx) {
            vpCvx = ERC1155PresetMinterSupply(contractAddress);
            return;
        }

        if (c == Contract.RpCvx) {
            rpCvx = ERC1155PresetMinterSupply(contractAddress);
            return;
        }

        spCvxImplementation = contractAddress;
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
    function removeVoteDelegate() external onlyOwner {
        voteDelegate = address(0);

        emit RemoveVoteDelegate();

        cvxDelegateRegistry.clearDelegate(delegationSpace);
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
        @notice Get current snapshot id
        @return uint256  Current snapshot id
     */
    function getCurrentSnapshotId() external view returns (uint256) {
        return _getCurrentSnapshotId();
    }

    /**
        @notice Get rewards for an epoch
        @param  epoch                  uint256    Epoch
        @return _rewards               address[]  Reward tokens
        @return snapshotRewardAmounts  uint256[]  Snapshot reward amounts
        @return futuresRewardAmounts   uint256[]  Futures reward amounts
     */
    function getRewards(uint256 epoch)
        external
        view
        returns (
            address[] memory _rewards,
            uint256[] memory snapshotRewardAmounts,
            uint256[] memory futuresRewardAmounts
        )
    {
        return (
            rewards[epoch],
            snapshotRewards[epoch].amounts,
            futuresRewards[epoch].amounts
        );
    }

    /**
        @notice Snapshot token balances
     */
    function snapshot() public {
        uint256 currentEpoch = getCurrentEpoch();

        if (epochSnapshotIds[currentEpoch] == 0) {
            epochSnapshotIds[currentEpoch] = _snapshot();
        }
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
                ERC1155PresetMinterSupply(token).mint(
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

    /**
        @notice Claim Votium reward
        @param  token        address    Reward token address
        @param  index        uint256    Merkle tree node index
        @param  amount       uint256    Reward token amount
        @param  merkleProof  bytes32[]  Merkle proof
    */
    function claimVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external {
        // Snapshot pCVX token balances if we haven't already
        snapshot();

        // Used for determining reward amounts for snapshotted token holders
        uint256 snapshotId = _getCurrentSnapshotId();
        uint256 snapshotSupply = totalSupplyAt(snapshotId);
        uint256 currentEpoch = getCurrentEpoch();

        emit ClaimVotiumReward(token, index, amount, snapshotId);

        // Used for determining reward amounts for rpCVX token holders for this epoch
        uint256 epochRpCvxSupply = rpCvx.totalSupply(currentEpoch);

        // Used for calculating the actual token amount received
        uint256 prevBalance = ERC20(token).balanceOf(address(this));

        // Validates `token`, `index`, `amount`, and `merkleProof`
        votiumMultiMerkleStash.claim(
            token,
            index,
            address(this),
            amount,
            merkleProof
        );

        // Token amount after fees
        uint256 actualAmount = ERC20(token).balanceOf(address(this)) -
            prevBalance;

        // Rewards for snapshot balances, proportionate to the snapshot pCVX + rpCVX supply
        // E.g. if snapshot supply makes up 50% of that, then snapshotters receive 50% of rewards
        uint256 snapshotRewardsAmount = (actualAmount * snapshotSupply) /
            (snapshotSupply + epochRpCvxSupply);

        // Add reward token address, which shares the same index as the amount in the structs below
        rewards[currentEpoch].push(token);

        SnapshotRewards storage s = snapshotRewards[currentEpoch];
        s.amounts.push(snapshotRewardsAmount);

        FuturesRewards storage f = futuresRewards[currentEpoch];
        f.amounts.push(actualAmount - snapshotRewardsAmount);
    }

    /**
        @notice Claim a Snapshot reward as a pCVX holder
        @param  epoch        uint256  Epoch
        @param  rewardIndex  uint8    Reward token index
        @param  to           address  Snapshot reward recipient
    */
    function claimSnapshotReward(
        uint256 epoch,
        uint8 rewardIndex,
        address to
    ) external nonReentrant {
        if (epoch == 0) revert ZeroAmount();

        // Check whether msg.sender maintained a positive balance before the snapshot
        uint256 snapshotId = epochSnapshotIds[epoch];
        uint256 snapshotBalance = balanceOfAt(msg.sender, snapshotId);
        if (snapshotBalance == 0) revert InsufficientBalance();

        // Check whether msg.sender has already claimed this reward
        address reward = rewards[epoch][rewardIndex];
        if (snapshotRewards[epoch].claimed[msg.sender][reward] != 0)
            revert AlreadyClaimed();

        // Proportionate to the % of pCVX owned out of total supply for the snapshot
        uint256 claimAmount = (snapshotRewards[epoch].amounts[rewardIndex] *
            snapshotBalance) / totalSupplyAt(snapshotId);

        // Set claim amount to prevent re-claiming
        snapshotRewards[epoch].claimed[msg.sender][reward] = claimAmount;

        emit ClaimSnapshotReward(
            epoch,
            rewardIndex,
            to,
            snapshotId,
            snapshotBalance,
            reward,
            claimAmount
        );

        ERC20(reward).safeTransfer(to, claimAmount);
    }

    /**
        @notice Claim Futures rewards as a rpCVX holder for an epoch
        @param  epoch        uint256  Epoch / token id
        @param  to           address  Futures rewards recipient
    */
    function claimFuturesRewards(uint256 epoch, address to)
        external
        nonReentrant
    {
        if (epoch == 0) revert ZeroAmount();

        address[] memory r = rewards[epoch];

        emit ClaimFuturesRewards(epoch, to, r);

        // Check msg.sender rpCVX balance
        uint256 rpCvxBalance = rpCvx.balanceOf(msg.sender, epoch);
        if (rpCvxBalance == 0) revert InsufficientBalance();

        // Store rpCVX total supply before burning
        uint256 rpCvxTotalSupply = rpCvx.totalSupply(epoch);

        // Burn rpCVX tokens
        rpCvx.burn(msg.sender, epoch, rpCvxBalance);

        FuturesRewards memory f = futuresRewards[epoch];

        unchecked {
            // Loop over rewards and transfer the amount entitled to the rpCVX token holder
            for (uint8 i; i < r.length; ++i) {
                // Proportionate to the % of rpCVX owned out of the rpCVX total supply
                ERC20(r[i]).safeTransfer(to, f.amounts[i] * rpCvxBalance / rpCvxTotalSupply);
            }
        }
    }
}
