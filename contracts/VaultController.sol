// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LockedCvxVault} from "./LockedCvxVault.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";

contract VaultController is Ownable {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    ERC20 public immutable CVX;
    ICvxLocker public immutable CVX_LOCKER;
    uint256 public immutable EPOCH_DEPOSIT_DURATION;
    uint256 public immutable CVX_LOCK_DURATION;
    address public immutable LOCKED_CVX_VAULT_IMPLEMENTATION;

    mapping(uint256 => address) public lockedCvxVaultsByEpoch;

    event CreatedLockedCvxVault(
        address vault,
        uint256 depositDeadline,
        uint256 lockExpiry,
        string name,
        string symbol
    );
    event Deposited(address to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error VaultExistsForEpoch(uint256 epoch);

    constructor(
        ERC20 _CVX,
        ICvxLocker _CVX_LOCKER,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    ) {
        if (address(_CVX) == address(0)) revert ZeroAddress();
        CVX = _CVX;

        if (address(_CVX_LOCKER) == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        if (_EPOCH_DEPOSIT_DURATION == 0) revert ZeroAmount();
        EPOCH_DEPOSIT_DURATION = _EPOCH_DEPOSIT_DURATION;

        if (_CVX_LOCK_DURATION == 0) revert ZeroAmount();
        CVX_LOCK_DURATION = _CVX_LOCK_DURATION;

        LOCKED_CVX_VAULT_IMPLEMENTATION = address(new LockedCvxVault());
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
        @notice Deploy a LockedCvxVault instance for an epoch
        @param   epoch  uint256  Epoch without a LockedCvxVault instance
        @return  vault  address  LockedCvxVault address
     */
    function _createLockedCvxVault(uint256 epoch)
        internal
        returns (address vault)
    {
        if (lockedCvxVaultsByEpoch[epoch] != address(0))
            revert VaultExistsForEpoch(epoch);

        LockedCvxVault v = LockedCvxVault(
            Clones.clone(LOCKED_CVX_VAULT_IMPLEMENTATION)
        );

        uint256 depositDeadline = epoch + EPOCH_DEPOSIT_DURATION;
        uint256 lockExpiry = depositDeadline + CVX_LOCK_DURATION;
        string memory tokenId = string(
            abi.encodePacked("lockedCVX-", epoch.toString())
        );

        v.init(depositDeadline, lockExpiry, CVX_LOCKER, CVX, tokenId, tokenId);

        vault = address(v);
        lockedCvxVaultsByEpoch[epoch] = vault;

        emit CreatedLockedCvxVault(
            vault,
            depositDeadline,
            lockExpiry,
            tokenId,
            tokenId
        );

        return vault;
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

        if (address(v) == address(0)) {
            v = LockedCvxVault(_createLockedCvxVault(currentEpoch));
        }

        CVX.safeTransferFrom(msg.sender, address(this), amount);
        CVX.safeIncreaseAllowance(address(v), amount);
        v.deposit(to, amount);

        emit Deposited(to, amount);
    }
}
