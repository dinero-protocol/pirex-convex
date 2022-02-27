// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626VaultInitializable} from "./ERC4626VaultInitializable.sol";

interface ICvxLocker {
    struct LockedBalance {
        uint112 amount;
        uint112 boosted;
        uint32 unlockTime;
    }

    function lock(
        address _account,
        uint256 _amount,
        uint256 _spendRatio
    ) external;

    function lockedBalances(address _user)
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            LockedBalance[] memory lockData
        );

    function processExpiredLocks(
        bool _relock,
        uint256 _spendRatio,
        address _withdrawTo
    ) external;
}

contract LockedCvxVault is ERC4626VaultInitializable {
    using SafeERC20 for ERC20;

    uint256 public immutable DEPOSIT_DEADLINE;
    uint256 public immutable LOCK_EXPIRY;
    ICvxLocker public immutable CVX_LOCKER;

    event UnlockCvx(uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error AfterDepositDeadline(uint256 timestamp);
    error BeforeLockExpiry(uint256 timestamp);

    constructor(
        uint256 _DEPOSIT_DEADLINE,
        uint256 _LOCK_EXPIRY,
        ICvxLocker _CVX_LOCKER,
        ERC20 _underlying,
        string memory _name,
        string memory _symbol
    ) {
        if (_DEPOSIT_DEADLINE == 0) revert ZeroAmount();
        DEPOSIT_DEADLINE = _DEPOSIT_DEADLINE;

        if (_LOCK_EXPIRY == 0) revert ZeroAmount();
        LOCK_EXPIRY = _LOCK_EXPIRY;

        if (address(_CVX_LOCKER) == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        _initialize(_underlying, _name, _symbol);
    }

    /**
        @notice Unlocks CVX
     */
    function unlockCvx() external {
        uint256 balanceBefore = underlying.balanceOf(address(this));

        CVX_LOCKER.processExpiredLocks(false, 0, address(this));

        emit UnlockCvx(underlying.balanceOf(address(this)) - balanceBefore);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeDeposit(uint256 underlyingAmount) internal view override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (DEPOSIT_DEADLINE < block.timestamp)
            revert AfterDepositDeadline(block.timestamp);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeWithdraw(uint256 underlyingAmount) internal override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (LOCK_EXPIRY > block.timestamp)
            revert BeforeLockExpiry(block.timestamp);
    }

    /**
        @notice Lock CVX
        @param  underlyingAmount  uint256  CVX amount
     */
    function afterDeposit(uint256 underlyingAmount) internal override {
        underlying.safeIncreaseAllowance(address(CVX_LOCKER), underlyingAmount);
        CVX_LOCKER.lock(address(this), underlyingAmount, 0);
    }

    /**
        @notice Get total balance: locked CVX balance + CVX balance
     */
    function totalHoldings() public view override returns (uint256) {
        (uint256 total, , , ) = CVX_LOCKER.lockedBalances(address(this));

        return total + underlying.balanceOf(address(this));
    }
}
