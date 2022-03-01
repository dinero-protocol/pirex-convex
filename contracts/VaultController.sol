// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LockedCvxVault} from "./LockedCvxVault.sol";
import {VoteCvxVault} from "./VoteCvxVault.sol";

contract VaultController is Ownable {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    ERC20 public immutable CVX;
    address public immutable CVX_LOCKER;
    address public immutable VOTIUM_MULTI_MERKLE_STASH;
    uint256 public immutable EPOCH_DEPOSIT_DURATION;
    uint256 public immutable CVX_LOCK_DURATION;
    address public immutable LOCKED_CVX_VAULT_IMPLEMENTATION;
    address public immutable VOTE_CVX_VAULT_IMPLEMENTATION;

    mapping(uint256 => address) public lockedCvxVaultsByEpoch;
    mapping(uint256 => address) public voteCvxVaultsByEpoch;

    event CreatedLockedCvxVault(
        address vault,
        uint256 depositDeadline,
        uint256 lockExpiry,
        string tokenId
    );
    event CreatedVoteCvxVault(address vault, string tokenId);
    event Deposited(uint256 epoch, address to, uint256 amount);
    event Redeemed(uint256 epoch, address to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidVaultEpoch(uint256 epoch);
    error VaultAlreadyExists();

    constructor(
        ERC20 _CVX,
        address _CVX_LOCKER,
        address _VOTIUM_MULTI_MERKLE_STASH,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    ) {
        if (address(_CVX) == address(0)) revert ZeroAddress();
        CVX = _CVX;

        if (_CVX_LOCKER == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        if (_VOTIUM_MULTI_MERKLE_STASH == address(0)) revert ZeroAddress();
        VOTIUM_MULTI_MERKLE_STASH = _VOTIUM_MULTI_MERKLE_STASH;

        if (_EPOCH_DEPOSIT_DURATION == 0) revert ZeroAmount();
        EPOCH_DEPOSIT_DURATION = _EPOCH_DEPOSIT_DURATION;

        if (_CVX_LOCK_DURATION == 0) revert ZeroAmount();
        CVX_LOCK_DURATION = _CVX_LOCK_DURATION;

        LOCKED_CVX_VAULT_IMPLEMENTATION = address(new LockedCvxVault());
        VOTE_CVX_VAULT_IMPLEMENTATION = address(new VoteCvxVault());
    }

    /**
        @notice Get current epoch
        @return uint256 Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return
            (block.timestamp / EPOCH_DEPOSIT_DURATION) * EPOCH_DEPOSIT_DURATION;
    }

    /**
        @notice Create a LockedCvxVault
        @param   epoch  uint256  Epoch
        @return  vault  address  LockedCvxVault address
     */
    function _createLockedCvxVault(uint256 epoch)
        internal
        returns (address vault)
    {
        if (lockedCvxVaultsByEpoch[epoch] != address(0))
            revert VaultAlreadyExists();

        LockedCvxVault v = LockedCvxVault(
            Clones.clone(LOCKED_CVX_VAULT_IMPLEMENTATION)
        );
        uint256 depositDeadline = epoch + EPOCH_DEPOSIT_DURATION;
        uint256 lockExpiry = depositDeadline + CVX_LOCK_DURATION;
        string memory tokenId = string(
            abi.encodePacked("lockedCVX-", epoch.toString())
        );

        v.initialize(
            address(this),
            depositDeadline,
            lockExpiry,
            CVX_LOCKER,
            VOTIUM_MULTI_MERKLE_STASH,
            CVX,
            tokenId,
            tokenId
        );

        vault = address(v);
        lockedCvxVaultsByEpoch[epoch] = vault;

        emit CreatedLockedCvxVault(vault, depositDeadline, lockExpiry, tokenId);
    }

    /**
        @notice Create a VoteCvxVault
        @param   epoch  uint256  Epoch
        @return  vault  address  VoteCvxVault address
     */
    function _createVoteCvxVault(uint256 epoch)
        internal
        returns (address vault)
    {
        if (voteCvxVaultsByEpoch[epoch] != address(0))
            revert VaultAlreadyExists();

        VoteCvxVault v = VoteCvxVault(
            Clones.clone(VOTE_CVX_VAULT_IMPLEMENTATION)
        );
        string memory tokenId = string(
            abi.encodePacked("voteCVX-", epoch.toString())
        );

        v.initialize(epoch, tokenId, tokenId);

        vault = address(v);
        voteCvxVaultsByEpoch[epoch] = vault;

        emit CreatedVoteCvxVault(vault, tokenId);
    }

    /**
        @notice Mint voteCVX for 8 upcoming epochs
        @param  to      address  Account receiving voteCVX
        @param  amount  uint256  Amount voteCVX to mint
    */
    function _mintVoteCvx(address to, uint256 amount) internal {
        uint256 startingEpoch = getCurrentEpoch() + EPOCH_DEPOSIT_DURATION;

        unchecked {
            for (uint8 i; i < 8; ++i) {
                uint256 epoch = startingEpoch + (i * EPOCH_DEPOSIT_DURATION);
                VoteCvxVault v = VoteCvxVault(
                    _createVoteCvxVault(epoch)
                );

                v.mint(to, amount);
            }
        }
    }

    /**
        @notice Deposit CVX
        @param  to      address  Address receiving vault shares
        @param  amount  uint256  CVX amount
     */
    function deposit(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 currentEpoch = getCurrentEpoch();
        LockedCvxVault v = LockedCvxVault(lockedCvxVaultsByEpoch[currentEpoch]);

        // Transfer vault underlying and approve amount to be deposited
        CVX.safeTransferFrom(msg.sender, address(this), amount);
        CVX.safeIncreaseAllowance(address(v), amount);
        v.deposit(to, amount);
        _mintVoteCvx(to, amount);

        emit Deposited(currentEpoch, to, amount);
    }

    /**
        @notice Redeem CVX
        @param  epoch   uint256  Locked CVX epoch
        @param  to      address  Address receiving vault underlying
        @param  amount  uint256  Share amount
    */
    function redeem(
        uint256 epoch,
        address to,
        uint256 amount
    ) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        address vAddr = lockedCvxVaultsByEpoch[epoch];
        if (vAddr == address(0)) revert InvalidVaultEpoch(epoch);

        // Transfer vault shares to self and approve amount to be burned
        ERC20(vAddr).safeTransferFrom(msg.sender, address(this), amount);
        ERC20(vAddr).safeIncreaseAllowance(vAddr, amount);

        // Unlock CVX and redeem against shares
        LockedCvxVault v = LockedCvxVault(vAddr);
        v.unlockCvx();
        v.redeem(to, amount);

        emit Redeemed(epoch, to, amount);
    }

    /**
        @notice Claim Votium reward
        @param  epoch        uint256    Epoch
        @param  token        address    Reward token address
        @param  index        uint256    Merkle tree node index
        @param  amount       uint256    Reward token amount
        @param  merkleProof  bytes32[]  Merkle proof
    */
    function claimVotiumReward(
        uint256 epoch,
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external {
        if (lockedCvxVaultsByEpoch[epoch] == address(0))
            revert InvalidVaultEpoch(epoch);
        LockedCvxVault lockV = LockedCvxVault(lockedCvxVaultsByEpoch[epoch]);

        // This method must be called in the same epoch that bribes are distributed
        // Handled by protocol operators but may be incentivized later
        address voteVAddr = voteCvxVaultsByEpoch[getCurrentEpoch()];

        // Claim and transfer reward to VoteCVXVault
        lockV.claimVotiumReward(voteVAddr, token, index, amount, merkleProof);

        // Add reward so that vault can track and distribute rewards
        VoteCvxVault(voteVAddr).addReward(token);
    }
}
