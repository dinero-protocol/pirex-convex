// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (token/ERC20/ERC20.sol)

pragma solidity ^0.8.0;

// https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/master/contracts/token/ERC20/ERC20.sol

import {ERC20} from "../base/ERC20.sol";

contract Cvx is ERC20("Convex", "CVX") {
    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}
