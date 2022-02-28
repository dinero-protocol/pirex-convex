// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import {ERC20PresetMinterPauserUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VoteCvxVault is ERC20PresetMinterPauserUpgradeable {
    using SafeERC20 for ERC20;

    address public owner;

    function _init(string memory _name, string memory _symbol) external {
        owner = msg.sender;

        require(bytes(_name).length != 0, "Invalid _name");
        require(bytes(_symbol).length != 0, "Invalid _symbol");
        initialize(_name, _symbol);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    event Mint(address indexed to, uint256 amount);

    function mint(address to, uint256 amount) public override onlyOwner {
        _mint(to, amount);

        emit Mint(to, amount);
    }
}
