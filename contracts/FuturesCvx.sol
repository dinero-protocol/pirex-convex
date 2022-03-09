// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract FuturesCvx is OwnableUpgradeable, ERC20Upgradeable {
    uint256 public mintDeadline;

    error ZeroAmount();
    error EmptyString();
    error AfterMintDeadline(uint256 timestamp);

    function initialize(
        uint256 _mintDeadline,
        string memory _name,
        string memory _symbol
    ) external initializer {
        if (_mintDeadline == 0) revert ZeroAmount();
        mintDeadline = _mintDeadline;

        if (bytes(_name).length == 0 || bytes(_symbol).length == 0)
            revert EmptyString();
        __Ownable_init_unchained();
        __ERC20_init_unchained(_name, _symbol);
    }

    function mint(address account, uint256 amount) external onlyOwner {
        if (mintDeadline < block.timestamp)
            revert AfterMintDeadline(block.timestamp);
        _mint(account, amount);
    }
}
