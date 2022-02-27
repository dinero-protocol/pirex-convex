// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract VaultController is Ownable {
    address public cvx;
    uint256 public epochDepositDuration;

    constructor(address _cvx, uint256 _epochDepositDuration) {
        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;

        require(_epochDepositDuration != 0, "Invalid _epochDepositDuration");
        epochDepositDuration = _epochDepositDuration;
    }

    /**
        @notice Get current epoch
        @return uint256 Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return (block.timestamp / epochDepositDuration) * epochDepositDuration;
    }
}
