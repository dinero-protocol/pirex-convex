// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "./base/Ownable.sol";

contract PirexCVX is Ownable {
    struct vlCVX {
        uint256 amount;
        mapping(uint256 => mapping(address => uint256)) rewards;
    }

    address public cvxLocker;

    mapping(uint256 => vlCVX) public voteLockedCVX;

    constructor(address _cvxLocker) {
        require(_cvxLocker != address(0), "Invalid _cvxLocker");
        cvxLocker = _cvxLocker;
    }
}
