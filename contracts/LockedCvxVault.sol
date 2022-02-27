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
}

contract LockedCvxVault is ERC4626VaultInitializable {
    using SafeERC20 for ERC20;

    uint256 public immutable DEPOSIT_DEADLINE;
    ICvxLocker public immutable CVX_LOCKER;

    error ZeroAddress();
    error ZeroAmount();
    error AfterDeadline(uint256 timestamp);

    constructor(
        uint256 _DEPOSIT_DEADLINE,
        ICvxLocker _CVX_LOCKER,
        ERC20 _underlying,
        string memory _name,
        string memory _symbol
    ) {
        if (_DEPOSIT_DEADLINE == 0) revert ZeroAmount();
        DEPOSIT_DEADLINE = _DEPOSIT_DEADLINE;

        if (address(_CVX_LOCKER) == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        _initialize(_underlying, _name, _symbol);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeDeposit(uint256 underlyingAmount) internal override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (DEPOSIT_DEADLINE < block.timestamp) revert AfterDeadline(block.timestamp);
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
        @notice Get locked CVX balance
     */
    function totalHoldings() public view override returns (uint256) {
        (uint256 total, uint256 unlockable, uint256 locked, ) = CVX_LOCKER
            .lockedBalances(address(this));

        return total;
    }
}
