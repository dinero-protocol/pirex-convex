// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract UpCvx is ERC20Upgradeable {
    using SafeERC20 for ERC20;
    using Strings for uint256;

    ERC20 public cvx;
    address public pCvx;
    uint256 public mintDeadline;
    uint256 public lockExpiry;

    error ZeroAddress();
    error ZeroAmount();
    error InvalidLockExpiry();
    error NotAuthorized(address caller);
    error AfterMintDeadline(uint256 timestamp);
    event Minted(address to, uint256 amount);

    modifier onlyAuthorized() {
        if (msg.sender != pCvx) revert NotAuthorized(msg.sender);
        _;
    }

    /**
        @notice Initializes the contract
        @param  epoch  uint256  Epoch (2 weeks)
        @param  _cvx   address  CVX address
        @param  _pCvx  address  PirexCvx address
     */
    function initialize(
        uint256 epoch,
        address _cvx,
        address _pCvx
    ) external initializer {
        if (epoch == 0) revert ZeroAmount();
        __ERC20_init_unchained(
            "Unlocking Pirex CVX",
            string(abi.encodePacked("upCVX-", epoch.toString()))
        );

        // Only enable mints within 2 weeks of the epoch
        mintDeadline = epoch + 2 weeks;

        // CVX can be redeemed 17 weeks after the first redemption initiations
        lockExpiry = epoch + 17 weeks;

        if (_cvx == address(0)) revert ZeroAddress();
        cvx = ERC20(_cvx);

        if (_pCvx == address(0)) revert ZeroAddress();
        pCvx = _pCvx;
    }

    /**
        @notice Mint upCVX
        @param  to      address  Recipient
        @param  amount  uint256  Amount
     */
    function mint(address to, uint256 amount) external onlyAuthorized {
        if (mintDeadline < block.timestamp) revert AfterMintDeadline(block.timestamp);
        if (amount == 0) revert ZeroAmount();

        // Validates `to`
        _mint(to, amount);

        emit Minted(to, amount);
    }
}
