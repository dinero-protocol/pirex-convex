// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626VaultInitializable} from "./ERC4626VaultInitializable.sol";

contract LockedCvxVault is ERC4626VaultInitializable {
    using SafeERC20 for ERC20;

    uint256 public immutable DEPOSIT_DEADLINE;
    address public immutable CVX_LOCKER;

    error ZeroAddress();
    error ZeroAmount();

    constructor(
        uint256 _DEPOSIT_DEADLINE,
        address _CVX_LOCKER,
        ERC20 _underlying,
        string memory _name,
        string memory _symbol
    ) {
        if (_DEPOSIT_DEADLINE == 0) revert ZeroAmount();
        DEPOSIT_DEADLINE = _DEPOSIT_DEADLINE;

        if (_CVX_LOCKER == address(0)) revert ZeroAddress();
        CVX_LOCKER = _CVX_LOCKER;

        _initialize(_underlying, _name, _symbol);
    }
}
