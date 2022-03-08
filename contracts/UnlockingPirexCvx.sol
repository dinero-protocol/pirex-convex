// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract UnlockingPirexCvx is ERC20Upgradeable {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    ERC20 public cvx;
    uint256 public lockExpiry;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidLockExpiry();

    /**
        @notice Initializes the contract
        @param  epoch  uint256  Epoch (2 weeks)
        @param  _cvx   address  CVX address
     */
    function initialize(uint256 epoch, address _cvx) external initializer {
        if (epoch == 0) revert ZeroAmount();
        __ERC20_init_unchained(
            "Unlocking Pirex CVX",
            string(abi.encodePacked("upCVX-", epoch.toString()))
        );

        // CVX can be redeemed 17 weeks after the first redemption initiations
        lockExpiry = epoch + 17 weeks;

        if (_cvx == address(0)) revert ZeroAddress();
        cvx = ERC20(_cvx);
    }
}
