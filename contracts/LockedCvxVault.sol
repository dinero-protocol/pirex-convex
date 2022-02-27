// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626VaultInitializable} from "./ERC4626VaultInitializable.sol";
import {ICvxLocker} from "./interfaces/ICvxLocker.sol";

contract LockedCvxVault is ERC4626VaultInitializable {
    using SafeERC20 for ERC20;

    uint256 public depositDeadline;
    uint256 public lockExpiry;
    ICvxLocker public cvxLocker;

    event UnlockCvx(uint256 amount);
    event LockCvx(uint256 amount);
    event Inititalized(
        uint256 _depositDeadline,
        uint256 _lockExpiry,
        ICvxLocker _cvxLocker,
        ERC20 _underlying,
        string _name,
        string _symbol
    );

    error ZeroAddress();
    error ZeroAmount();
    error AfterDepositDeadline(uint256 timestamp);
    error BeforeLockExpiry(uint256 timestamp);

    /**
        @notice Initializes the contract
        @param  _depositDeadline  uint256     Deposit deadline
        @param  _lockExpiry       uint256     Lock expiry for CVX (17 weeks after deposit deadline)
        @param  _cvxLocker        ICvxLocker  Deposit deadline
        @param  _underlying       ERC20       Underlying asset
        @param  _name             string      Token name
        @param  _symbol           string      Token symbol
     */
    function init(
        uint256 _depositDeadline,
        uint256 _lockExpiry,
        ICvxLocker _cvxLocker,
        ERC20 _underlying,
        string memory _name,
        string memory _symbol
    ) external {
        if (_depositDeadline == 0) revert ZeroAmount();
        depositDeadline = _depositDeadline;

        if (_lockExpiry == 0) revert ZeroAmount();
        lockExpiry = _lockExpiry;

        if (address(_cvxLocker) == address(0)) revert ZeroAddress();
        cvxLocker = _cvxLocker;

        _init(_underlying, _name, _symbol);
    }

    /**
        @notice Unlocks CVX
     */
    function unlockCvx() external {
        (, uint256 unlockable, , ) = cvxLocker.lockedBalances(address(this));
        cvxLocker.processExpiredLocks(false, 0, address(this));
        emit UnlockCvx(unlockable);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeDeposit(uint256 underlyingAmount) internal view override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (depositDeadline < block.timestamp)
            revert AfterDepositDeadline(block.timestamp);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeWithdraw(uint256 underlyingAmount) internal override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (lockExpiry > block.timestamp)
            revert BeforeLockExpiry(block.timestamp);
    }

    /**
        @notice Lock CVX
        @param  underlyingAmount  uint256  CVX amount
     */
    function afterDeposit(uint256 underlyingAmount) internal override {
        underlying.safeIncreaseAllowance(address(cvxLocker), underlyingAmount);
        cvxLocker.lock(address(this), underlyingAmount, 0);
        emit LockCvx(underlyingAmount);
    }

    /**
        @notice Get total balance: locked CVX balance + CVX balance
     */
    function totalHoldings() public view override returns (uint256) {
        (uint256 total, , , ) = cvxLocker.lockedBalances(address(this));

        return total + underlying.balanceOf(address(this));
    }
}
