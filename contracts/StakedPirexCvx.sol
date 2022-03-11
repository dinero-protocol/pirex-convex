// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC4626VaultUpgradeable} from "./ERC4626VaultUpgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract StakedPirexCvx is ERC4626VaultUpgradeable {
    uint256 public stakeExpiry;

    event Initialize(
        uint256 stakeDuration,
        address underlying,
        string name,
        string symbol
    );

    error ZeroAddress();
    error ZeroAmount();
    error BeforeDepositDeadline();
    error BeforeStakeExpiry();

    /**
        @notice Initializes the contract - reverts if called more than once
        @param  _stakeExpiry  uint256  Timestamp after which pCVX can be unstaked
        @param  _underlying   ERC20    Underlying asset
        @param  _name         string   Token name
        @param  _symbol       string   Token symbol
     */
    function initialize(
        uint256 _stakeExpiry,
        ERC20 _underlying,
        string memory _name,
        string memory _symbol
    ) external {
        if (_stakeExpiry == 0) revert ZeroAmount();
        stakeExpiry = _stakeExpiry;

        _initialize(_underlying, _name, _symbol);

        emit Initialize(_stakeExpiry, address(_underlying), _name, _symbol);
    }

    /**
        @notice Check underlying amount and timestamp
        @param  underlyingAmount  uint256  CVX amount
     */
    function beforeWithdraw(uint256 underlyingAmount) internal view override {
        if (underlyingAmount == 0) revert ZeroAmount();
        if (stakeExpiry > block.timestamp) revert BeforeStakeExpiry();
    }
}
