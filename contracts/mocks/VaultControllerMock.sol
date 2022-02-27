// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ICvxLocker} from "../interfaces/ICvxLocker.sol";
import {VaultController} from "../VaultController.sol";

contract VaultControllerMock is VaultController {
    constructor(
        ERC20 _CVX,
        ICvxLocker _CVX_LOCKER,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    )
        VaultController(
            _CVX,
            _CVX_LOCKER,
            _EPOCH_DEPOSIT_DURATION,
            _CVX_LOCK_DURATION
        )
    {}

    function createLockedCvxVault(uint256 epoch)
        external
        returns (address vault)
    {
        return _createLockedCvxVault(epoch);
    }
}
