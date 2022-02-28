// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import {ERC20PresetMinterPauserUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/presets/ERC20PresetMinterPauserUpgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VoteCvxVault is ERC20PresetMinterPauserUpgradeable {
    using SafeERC20 for ERC20;

    address public owner;
    uint256 public mintDeadline;

    event Mint(address indexed to, uint256 amount);

    error ZeroAmount();
    error EmptyString();
    error AfterMintDeadline(uint256 timestamp);

    function init(
        uint256 _mintDeadline,
        string memory _name,
        string memory _symbol
    ) external {
        owner = msg.sender;

        if (_mintDeadline == 0) revert ZeroAmount();
        mintDeadline = _mintDeadline;

        if (bytes(_name).length == 0) revert EmptyString();
        if (bytes(_symbol).length == 0) revert EmptyString();
        initialize(_name, _symbol);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    function mint(address to, uint256 amount) public override onlyOwner {
        if (mintDeadline < block.timestamp)
            revert AfterMintDeadline(block.timestamp);
        _mint(to, amount);

        emit Mint(to, amount);
    }
}
