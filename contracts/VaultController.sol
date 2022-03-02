// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LockedCvxVault} from "./LockedCvxVault.sol";
import {TriCvxVault} from "./TriCvxVault.sol";
import {VotiumRewardClaimer} from "./VotiumRewardClaimer.sol";

contract VaultController is Ownable {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    ERC20 public immutable CVX;
    address public immutable CVX_LOCKER;
    address public immutable VOTIUM_MULTI_MERKLE_STASH;
    address public immutable VOTIUM_ADDRESS_REGISTRY;
    uint256 public immutable EPOCH_DEPOSIT_DURATION;
    uint256 public immutable CVX_LOCK_DURATION;
    address public immutable LOCKED_CVX_VAULT_IMPLEMENTATION;
    address public immutable TRI_CVX_VAULT_IMPLEMENTATION;
    address public immutable VOTIUM_REWARD_CLAIMER_IMPLEMENTATION;

    mapping(uint256 => address) public lockedCvxVaultsByEpoch;
    mapping(uint256 => address) public triCvxVaultsByEpoch;
    mapping(address => address) public votiumRewardClaimerByLockedCvxVault;

    event CreatedLockedCvxVault(
        address vault,
        uint256 depositDeadline,
        uint256 lockExpiry,
        string tokenId
    );
    event CreatedTriCvxVault(address vault, uint256 epoch);
    event CreatedVotiumRewardClaimer(
        address votiumRewardClaimer,
        address lockedCvxVault,
        address[8] triCvxVaults
    );
    event SetUpVaults(
        address lockedCvxVault,
        address[8] triCvxVaults,
        address votiumRewardClaimer
    );
    event Deposited(uint256 epoch, address to, uint256 amount);
    event Redeemed(uint256 epoch, address to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidVaultEpoch(uint256 epoch);
    error AlreadyExists();
    error AfterMintDeadline(uint256 epoch);

    constructor(
        ERC20 _CVX,
        address _CVX_LOCKER,
        address _VOTIUM_MULTI_MERKLE_STASH,
        address _VOTIUM_ADDRESS_REGISTRY,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    ) {
        if (address(_CVX) == address(0)) revert ZeroAddress();
        CVX = _CVX;

        if (_CVX_LOCKER == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        if (_VOTIUM_MULTI_MERKLE_STASH == address(0)) revert ZeroAddress();
        VOTIUM_MULTI_MERKLE_STASH = _VOTIUM_MULTI_MERKLE_STASH;

        if (_VOTIUM_ADDRESS_REGISTRY == address(0)) revert ZeroAddress();
        VOTIUM_ADDRESS_REGISTRY = _VOTIUM_ADDRESS_REGISTRY;

        if (_EPOCH_DEPOSIT_DURATION == 0) revert ZeroAmount();
        EPOCH_DEPOSIT_DURATION = _EPOCH_DEPOSIT_DURATION;

        if (_CVX_LOCK_DURATION == 0) revert ZeroAmount();
        CVX_LOCK_DURATION = _CVX_LOCK_DURATION;

        LOCKED_CVX_VAULT_IMPLEMENTATION = address(new LockedCvxVault());
        TRI_CVX_VAULT_IMPLEMENTATION = address(new TriCvxVault());
        VOTIUM_REWARD_CLAIMER_IMPLEMENTATION = address(
            new VotiumRewardClaimer()
        );
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
        @param   epoch    uint256         Epoch
        @return  address  LockedCvxVault address
     */
    function _createLockedCvxVault(uint256 epoch) internal returns (address) {
        if (lockedCvxVaultsByEpoch[epoch] != address(0)) revert AlreadyExists();

        LockedCvxVault vault = LockedCvxVault(
            Clones.clone(LOCKED_CVX_VAULT_IMPLEMENTATION)
        );
        uint256 depositDeadline = epoch + EPOCH_DEPOSIT_DURATION;
        uint256 lockExpiry = depositDeadline + CVX_LOCK_DURATION;
        string memory tokenId = string(
            abi.encodePacked("lockedCVX-", epoch.toString())
        );
        address vaultAddr = address(vault);
        lockedCvxVaultsByEpoch[epoch] = vaultAddr;

        vault.initialize(
            address(this),
            depositDeadline,
            lockExpiry,
            CVX_LOCKER,
            VOTIUM_ADDRESS_REGISTRY,
            CVX,
            tokenId,
            tokenId
        );

        emit CreatedLockedCvxVault(
            vaultAddr,
            depositDeadline,
            lockExpiry,
            tokenId
        );

        return vaultAddr;
    }

    /**
        @notice Create a TriCvxVault
        @param   epoch    uint256       Epoch
        @return  address  TriCvxVault address
     */
    function _createTriCvxVault(uint256 epoch) internal returns (address) {
        if (triCvxVaultsByEpoch[epoch] != address(0)) revert AlreadyExists();

        TriCvxVault vault = TriCvxVault(
            Clones.clone(TRI_CVX_VAULT_IMPLEMENTATION)
        );
        address vaultAddr = address(vault);
        triCvxVaultsByEpoch[epoch] = vaultAddr;

        vault.initialize(epoch);

        emit CreatedTriCvxVault(vaultAddr, epoch);

        return vaultAddr;
    }

    /**
        @notice Create a VotiumRewardClaimer
        @param  lockedCvxVault  address     LockedCvxVault address
        @param  triCvxVaults    address[8]  TriCvxVault addresses
        @param  tokenEpochs     uint256[8]  TriCvxVault epochs
     */
    function _createVotiumRewardClaimer(
        address lockedCvxVault,
        address[8] memory triCvxVaults,
        uint256[8] memory tokenEpochs
    ) internal returns (address) {
        if (votiumRewardClaimerByLockedCvxVault[lockedCvxVault] != address(0))
            revert AlreadyExists();

        VotiumRewardClaimer v = VotiumRewardClaimer(
            Clones.clone(VOTIUM_REWARD_CLAIMER_IMPLEMENTATION)
        );
        address vAddr = address(v);
        votiumRewardClaimerByLockedCvxVault[lockedCvxVault] = vAddr;

        v.initialize(
            address(this),
            lockedCvxVault,
            VOTIUM_MULTI_MERKLE_STASH,
            triCvxVaults,
            tokenEpochs
        );

        // Forwards LockedCvxVault rewards to fresh VotiumRewardClaimer
        LockedCvxVault(lockedCvxVault).forwardVotiumRewards(vAddr);

        emit CreatedVotiumRewardClaimer(vAddr, lockedCvxVault, triCvxVaults);

        return vAddr;
    }

    /**
        @notice Set up vaults for an epoch
        @param   epoch                uint256     Epoch
        @return  lockedCvxVault       address     LockedCvxVault address
        @return  triCvxVaults        address[8]  TriCvxVault addresses
        @return  votiumRewardClaimer  address     VotiumRewardClaimer address
    */
    function setUpVaults(uint256 epoch)
        external
        returns (
            address lockedCvxVault,
            address[8] memory triCvxVaults,
            address votiumRewardClaimer
        )
    {
        if (epoch == 0) revert InvalidVaultEpoch(epoch);

        // Create a LockedCvxVault for the epoch if it doesn't exist
        lockedCvxVault = lockedCvxVaultsByEpoch[epoch] == address(0)
            ? _createLockedCvxVault(epoch)
            : lockedCvxVaultsByEpoch[epoch];

        // Use the next epoch as a starting point for TriCvxVaults since voting
        // and rewards don't start until after the LockedCvxVault deposit deadline
        uint256 startingEpoch = epoch + EPOCH_DEPOSIT_DURATION;
        uint256[8] memory tokenEpochs;

        // Create a TriCvxVault for each Convex voting round (8 total per lock)
        for (uint8 i; i < 8; ++i) {
            tokenEpochs[i] = startingEpoch + (i * EPOCH_DEPOSIT_DURATION);

            triCvxVaults[i] = triCvxVaultsByEpoch[tokenEpochs[i]] == address(0)
                ? _createTriCvxVault(tokenEpochs[i])
                : triCvxVaultsByEpoch[tokenEpochs[i]];
        }

        votiumRewardClaimer = votiumRewardClaimerByLockedCvxVault[
            lockedCvxVault
        ] == address(0)
            ? _createVotiumRewardClaimer(
                lockedCvxVault,
                triCvxVaults,
                tokenEpochs
            )
            : votiumRewardClaimerByLockedCvxVault[lockedCvxVault];

        emit SetUpVaults(lockedCvxVault, triCvxVaults, votiumRewardClaimer);
    }

    /**
        @notice Mint vote, bribe, and reward CVX tokens for Convex voting rounds
        @param  startingEpoch  uint256  Epoch to start minting tokens
        @param  to                 address  Account receiving tokens
        @param  amount             uint256  Amount tokens to mint
    */
    function _mintTriCvxTokens(
        uint256 startingEpoch,
        address to,
        uint256 amount
    ) internal {
        if (startingEpoch < getCurrentEpoch() + EPOCH_DEPOSIT_DURATION)
            revert AfterMintDeadline(startingEpoch);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        unchecked {
            for (uint8 i; i < 8; ++i) {
                TriCvxVault(
                    triCvxVaultsByEpoch[
                        startingEpoch + (i * EPOCH_DEPOSIT_DURATION)
                    ]
                ).mint(to, amount);
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

        // Validates zero address
        CVX.safeIncreaseAllowance(address(v), amount);

        v.deposit(to, amount);
        _mintTriCvxTokens(currentEpoch + EPOCH_DEPOSIT_DURATION, to, amount);

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
        if (epoch == 0) revert InvalidVaultEpoch(epoch);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        address vAddr = lockedCvxVaultsByEpoch[epoch];
        if (vAddr == address(0)) revert InvalidVaultEpoch(epoch);

        LockedCvxVault v = LockedCvxVault(vAddr);

        // Transfer vault shares to self and approve amount to be burned
        ERC20(vAddr).safeTransferFrom(msg.sender, address(this), amount);
        ERC20(vAddr).safeIncreaseAllowance(vAddr, amount);

        // Unlock CVX and redeem against shares
        v.unlockCvx();
        v.redeem(to, amount);

        emit Redeemed(epoch, to, amount);
    }
}
