// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626Upgradeable} from "./ERC4626Upgradeable.sol";

contract StakedPirexCvx is ERC4626Upgradeable {
    uint256 public stakeExpiry;

    event Initialize(
        uint256 stakeDuration,
        address underlying,
        string name,
        string symbol
    );

    error ZeroAmount();
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

    function totalAssets() public view override returns (uint256) {
        return asset.balanceOf(address(this));
    }

    /**
        @notice Check underlying amount and timestamp
        @param  assets  uint256  CVX amount
     */
    function beforeWithdraw(uint256 assets, uint256) internal view override {
        if (assets == 0) revert ZeroAmount();
        if (stakeExpiry > block.timestamp) revert BeforeStakeExpiry();
    }
}
