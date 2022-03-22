// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20Snapshot} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Snapshot.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ERC1155PresetMinterSupply} from "./ERC1155PresetMinterSupply.sol";
import {PirexCvxConvex} from "./PirexCvxConvex.sol";
import {IVotiumMultiMerkleStash} from "./interfaces/IVotiumMultiMerkleStash.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";
import {StakedPirexCvx} from "./StakedPirexCvx.sol";
import {PirexFees} from "./PirexFees.sol";

contract PirexCvx is ReentrancyGuard, ERC20Snapshot, PirexCvxConvex {
    using SafeERC20 for ERC20;

    /**
        @notice Epoch details
        @notice Reward/snapshotRewards/futuresRewards indexes are associated with 1 reward
        @param  snapshotId              uint256    Snapshot id
        @param  rewards                 address[]  Rewards
        @param  snapshotRewards         uint256[]  Snapshot reward amounts
        @param  futuresRewards          uint256[]  Futures reward amounts
        @param  claimedSnapshotRewards  mapping    Claimed snapshot rewards
     */
    struct Epoch {
        uint256 snapshotId;
        address[] rewards;
        uint256[] snapshotRewards;
        uint256[] futuresRewards;
        mapping(address => mapping(uint8 => uint256)) claimedSnapshotRewards;
    }

    // Users can choose between the two futures tokens when staking or unlocking
    enum Futures {
        Vote,
        Reward
    }

    // Configurable contracts
    enum Contract {
        PirexFees,
        UpCvx,
        VpCvx,
        RpCvx,
        SpCvxImplementation
    }

    // Configurable fees
    enum Fees {
        Deposit,
        Reward
    }

    // Seconds between Convex voting rounds (2 weeks)
    uint32 public immutable EPOCH_DURATION = 1209600;

    // Seconds before upCVX can be redeemed for CVX (17 weeks)
    uint32 public immutable UNLOCKING_DURATION = 10281600;

    // Fee denominator
    uint32 public immutable FEE_DENOMINATOR = 1000000;

    PirexFees public pirexFees;
    IVotiumMultiMerkleStash public votiumMultiMerkleStash;
    ERC1155PresetMinterSupply public upCvx;
    ERC1155PresetMinterSupply public vpCvx;
    ERC1155PresetMinterSupply public rpCvx;

    // Staked Pirex CVX implementation
    address public spCvxImplementation;
    address[] public spCvx;

    // Epochs mapped to epoch details
    mapping(uint256 => Epoch) private epochs;

    // Fees (e.g. 5000 / 1000000 = 0.5%)
    mapping(Fees => uint16) public fees;

    // Convex unlock timestamps mapped to amount being redeemed
    mapping(uint256 => uint256) public redemptions;

    event SetContract(Contract c, address contractAddress);
    event SetFee(Fees f, uint16 amount);
    event MintFutures(
        uint8 rounds,
        address indexed to,
        uint256 amount,
        Futures indexed f
    );
    event Deposit(address indexed to, uint256 shares, uint256 fee);
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
    event ClaimFuturesRewards(uint256 epoch, address to, address[] rewards);
    event PerformEpochMaintenance(uint256 epoch, uint256 snapshotId);

    error InvalidFee();
    error BeforeLockExpiry();
    error InsufficientBalance();
    error AlreadyClaimed();
    error MaintenanceRequired();
    error InsufficientRedemptionAllowance();

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
        @param  _cvxRewardPool           address  CvxRewardPool address
        @param  _pirexFees               address  PirexFees address
        @param  _votiumMultiMerkleStash  address  VotiumMultiMerkleStash address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _cvxRewardPool,
        address _pirexFees,
        address _votiumMultiMerkleStash
    )
        ERC20("Pirex CVX", "pCVX")
        PirexCvxConvex(_CVX, _cvxLocker, _cvxDelegateRegistry, _cvxRewardPool)
    {
        // Start snapshot id from 1 and set it to simplify snapshot-taking determination
        epochs[getCurrentEpoch()].snapshotId = _snapshot();

        if (_pirexFees == address(0)) revert ZeroAddress();
        pirexFees = PirexFees(_pirexFees);

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

        if (c == Contract.PirexFees) {
            pirexFees = PirexFees(contractAddress);
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
        @notice Set fee
        @param  f       Fees    Fee enum
        @param  amount  uint16  Fee amount
     */
    function setFee(Fees f, uint16 amount) external onlyOwner {
        // Fees cannot be greater than 5%
        if (amount > 50000) revert InvalidFee();

        emit SetFee(f, amount);

        if (f == Fees.Deposit) {
            fees[Fees.Deposit] = amount;
            return;
        }

        fees[Fees.Reward] = amount;
    }

    /**
        @notice Get current epoch
        @return uint256  Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp / EPOCH_DURATION) * EPOCH_DURATION;
    }

    /**
        @notice Get current snapshot id
        @return uint256  Current snapshot id
     */
    function getCurrentSnapshotId() external view returns (uint256) {
        return _getCurrentSnapshotId();
    }

    /**
        @notice Get spCvx
        @return address[]  StakedPirexCvx vault addresses
     */
    function getSpCvx() external view returns (address[] memory) {
        return spCvx;
    }

    /**
        @notice Get epoch
        @param  epoch            uint256    Epoch
        @return snapshotId       uint256    Snapshot id
        @return rewards          address[]  Reward tokens
        @return snapshotRewards  uint256[]  Snapshot reward amounts
        @return futuresRewards   uint256[]  Futures reward amounts
     */
    function getEpoch(uint256 epoch)
        external
        view
        returns (
            uint256 snapshotId,
            address[] memory rewards,
            uint256[] memory snapshotRewards,
            uint256[] memory futuresRewards
        )
    {
        Epoch storage e = epochs[epoch];

        return (e.snapshotId, e.rewards, e.snapshotRewards, e.futuresRewards);
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
        emit MintFutures(rounds, to, amount, f);

        unchecked {
            uint256 startingEpoch = getCurrentEpoch() + EPOCH_DURATION;
            address token = f == Futures.Vote ? address(vpCvx) : address(rpCvx);

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
        @notice Claim misc. rewards (e.g. Convex platform fees)
     */
    function _claimMiscRewards() internal {
        // Get claimable rewards and balances
        ConvexReward[] memory c = _claimableRewards();
        uint256 cLen = c.length;
        address addr = address(this);

        // Claim rewards from Convex
        _getReward();

        uint256 currentEpoch = getCurrentEpoch();
        Epoch storage e = epochs[currentEpoch];
        uint256 snapshotSupply = totalSupplyAt(e.snapshotId);
        uint256 combinedSupply = snapshotSupply +
            rpCvx.totalSupply(currentEpoch);
        address pirexFeesAddr = address(pirexFees);

        // Calculate the rewards for both pCVX/snapshot and rpCVX/futures holders
        for (uint8 i; i < cLen; ++i) {
            if (c[i].amount == 0) continue;

            address t = c[i].token;

            // Tokens actually received (after factoring in token fees and existing balance)
            uint256 received = ERC20(t).balanceOf(addr) - c[i].balance;

            uint256 rewardFee = (received * fees[Fees.Reward]) /
                FEE_DENOMINATOR;
            uint256 rewards = received - rewardFee;
            uint256 snapshotRewardAmount = (rewards * snapshotSupply) /
                combinedSupply;

            e.rewards.push(t);
            e.snapshotRewards.push(snapshotRewardAmount);
            e.futuresRewards.push(rewards - snapshotRewardAmount);

            // Distribute fees
            ERC20(t).safeIncreaseAllowance(pirexFeesAddr, rewardFee);
            pirexFees.distributeFees(t, rewardFee);
        }
    }

    /**
        @notice Deposit CVX
        @param  to      address  Address receiving pCVX
        @param  amount  uint256  CVX amount
     */
    function deposit(address to, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 fee = (amount * fees[Fees.Deposit]) / FEE_DENOMINATOR;
        uint256 postFeeAmount = amount - fee;

        // Mint pCVX - validates `to`
        _mint(to, postFeeAmount);

        emit Deposit(to, postFeeAmount, fee);

        // Transfer CVX to self and approve for locking
        CVX.safeTransferFrom(msg.sender, address(this), amount);

        // Allow pirexFees to distribute the deposit fee
        CVX.safeIncreaseAllowance(address(pirexFees), fee);
        pirexFees.distributeFees(address(CVX), fee);

        // Lock post-fee CVX amount
        _lock(postFeeAmount);
    }

    /**
        @notice Initiate CVX redemption
        @param  lockIndex  uint8    Locked balance index
        @param  to         address  upCVX recipient
        @param  amount     uint256  pCVX/upCVX amount
        @param  f          enum     Futures
     */
    function initiateRedemption(
        uint8 lockIndex,
        address to,
        uint256 amount,
        Futures f
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        (, , , ICvxLocker.LockedBalance[] memory lockData) = cvxLocker
            .lockedBalances(address(this));

        ICvxLocker.LockedBalance memory l = lockData[lockIndex];
        uint256 unlockAmount = l.amount;
        uint256 unlockTime = l.unlockTime;

        // Check if there is a sufficient amount of CVX being unlocked for redemption
        if (amount > unlockAmount) revert InsufficientRedemptionAllowance();

        // Check if there is any available after redemption initiations by others
        if (amount > (unlockAmount - redemptions[unlockTime]))
            revert InsufficientRedemptionAllowance();

        // Increment redemptions for this specific unlock for future allowance checks
        redemptions[unlockTime] += amount;

        // Burn pCVX - validates `to`
        _burn(msg.sender, amount);

        // Track amount that needs to remain unlocked for redemptions
        cvxOutstanding += amount;

        emit InitiateRedemption(to, amount);

        // Mint upCVX associated with the current epoch - validates `to`
        upCvx.mint(to, unlockTime, amount, "");

        // Determine how many futures notes rounds to mint
        uint256 remainingTime = unlockTime - block.timestamp;
        uint8 rounds = uint8(remainingTime / EPOCH_DURATION);

        // Check if the lock was in the first week/half of an epoch
        // Handle case where remaining time is between 1 and 2 weeks
        if (
            unlockTime % EPOCH_DURATION != 0 &&
            remainingTime < EPOCH_DURATION &&
            remainingTime > (EPOCH_DURATION / 2)
        ) {
            // Rounds is zero if remainingTime is between 1 and 2 weeks
            // Increment by 1 since user should receive 1 round of rewards
            ++rounds;
        }

        // Mint vpCVX or rpCVX
        _mintFutures(rounds, to, amount, f);
    }

    /**
        @notice Redeem CVX
        @param  epoch   uint256  Epoch
        @param  to      address  CVX recipient
        @param  amount  uint256  upCVX/CVX amount
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
        s.deposit(amount, to);

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

        emit Unstake(vault, to, amount);

        // Transfer shares from msg.sender to self
        ERC20(vault).safeTransferFrom(msg.sender, address(this), amount);

        // Burn upCVX and transfer pCVX to `to`
        StakedPirexCvx(vault).redeem(amount, to, address(this));
    }

    /**
        @notice Snapshot token balances and claim misc. rewards for current epoch
     */
    function performEpochMaintenance() public {
        uint256 currentEpoch = getCurrentEpoch();

        // If snapshot has not been set for current epoch, perform maintenance
        if (epochs[currentEpoch].snapshotId == 0) {
            epochs[currentEpoch].snapshotId = _snapshot();

            emit PerformEpochMaintenance(
                currentEpoch,
                epochs[currentEpoch].snapshotId
            );

            // Only claim misc. rewards when a new snapshot is taken
            _claimMiscRewards();
        }
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
    ) external nonReentrant {
        // Check if maintenance has been performed on the epoch
        uint256 currentEpoch = getCurrentEpoch();
        if (epochs[currentEpoch].snapshotId == 0) revert MaintenanceRequired();

        // Used for determining reward amounts for snapshotted token holders
        uint256 snapshotId = _getCurrentSnapshotId();
        uint256 snapshotSupply = totalSupplyAt(snapshotId);

        emit ClaimVotiumReward(token, index, amount, snapshotId);

        ERC20 t = ERC20(token);

        // Used for calculating the actual token amount received
        uint256 prevBalance = t.balanceOf(address(this));

        // Validates `token`, `index`, `amount`, and `merkleProof`
        votiumMultiMerkleStash.claim(
            token,
            index,
            address(this),
            amount,
            merkleProof
        );

        // Tokens actually received (after factoring in token fees and existing balance)
        uint256 received = t.balanceOf(address(this)) - prevBalance;
        uint256 rewardFee = (received * fees[Fees.Reward]) / FEE_DENOMINATOR;
        uint256 rewards = received - rewardFee;

        // Rewards for snapshot balances, proportionate to the snapshot pCVX + rpCVX supply
        // E.g. if snapshot supply makes up 50% of that, then snapshotters receive 50% of rewards
        uint256 snapshotRewardsAmount = (rewards * snapshotSupply) /
            (snapshotSupply + rpCvx.totalSupply(currentEpoch));

        // Add reward token address and snapshot/futuresRewards amounts (same index for all)
        epochs[currentEpoch].rewards.push(token);
        epochs[currentEpoch].snapshotRewards.push(snapshotRewardsAmount);
        epochs[currentEpoch].futuresRewards.push(
            rewards - snapshotRewardsAmount
        );

        // Distribute fees
        t.safeIncreaseAllowance(address(pirexFees), rewardFee);
        pirexFees.distributeFees(token, rewardFee);
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

        Epoch storage e = epochs[epoch];

        // Check whether msg.sender maintained a positive balance before the snapshot
        uint256 snapshotId = e.snapshotId;
        uint256 snapshotBalance = balanceOfAt(msg.sender, snapshotId);
        if (snapshotBalance == 0) revert InsufficientBalance();

        // Check whether msg.sender has already claimed this reward
        address reward = e.rewards[rewardIndex];
        if (e.claimedSnapshotRewards[msg.sender][rewardIndex] != 0)
            revert AlreadyClaimed();

        // Proportionate to the % of pCVX owned out of total supply for the snapshot
        uint256 claimAmount = (e.snapshotRewards[rewardIndex] *
            snapshotBalance) / totalSupplyAt(snapshotId);

        // Set claim amount to prevent re-claiming
        e.claimedSnapshotRewards[msg.sender][rewardIndex] = claimAmount;

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
        @param  epoch  uint256  Epoch (ERC1155 token id)
        @param  to     address  Futures rewards recipient
    */
    function claimFuturesRewards(uint256 epoch, address to)
        external
        nonReentrant
    {
        if (epoch == 0) revert ZeroAmount();

        address[] memory r = epochs[epoch].rewards;

        emit ClaimFuturesRewards(epoch, to, r);

        // Check msg.sender rpCVX balance
        uint256 rpCvxBalance = rpCvx.balanceOf(msg.sender, epoch);
        if (rpCvxBalance == 0) revert InsufficientBalance();

        // Store rpCVX total supply before burning
        uint256 rpCvxTotalSupply = rpCvx.totalSupply(epoch);

        // Burn rpCVX tokens
        rpCvx.burn(msg.sender, epoch, rpCvxBalance);

        unchecked {
            uint256[] memory f = epochs[epoch].futuresRewards;

            // Loop over rewards and transfer the amount entitled to the rpCVX token holder
            for (uint8 i; i < r.length; ++i) {
                // Proportionate to the % of rpCVX owned out of the rpCVX total supply
                ERC20(r[i]).safeTransfer(
                    to,
                    (f[i] * rpCvxBalance) / rpCvxTotalSupply
                );
            }
        }
    }
}
