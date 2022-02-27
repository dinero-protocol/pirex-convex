// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IConvexToken} from "./mocks/IConvexToken.sol";

contract VaultController is Ownable {
    IConvexToken public immutable CVX;
    uint256 public immutable EPOCH_DEPOSIT_DURATION;

    error ZeroAddress();
    error ZeroAmount();

    constructor(IConvexToken _CVX, uint256 _EPOCH_DEPOSIT_DURATION) {
        if (address(_CVX) == address(0)) revert ZeroAddress();
        CVX = _CVX;

        if (_EPOCH_DEPOSIT_DURATION == 0) revert ZeroAmount();
        EPOCH_DEPOSIT_DURATION = _EPOCH_DEPOSIT_DURATION;
    }

    /**
        @notice Get current epoch
        @return uint256 Current epoch
     */
    function getCurrentEpoch() public view returns (uint256) {
        return
            (block.timestamp / EPOCH_DEPOSIT_DURATION) * EPOCH_DEPOSIT_DURATION;
    }
}
