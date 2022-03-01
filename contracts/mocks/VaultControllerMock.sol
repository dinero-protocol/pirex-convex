// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VaultController} from "../VaultController.sol";

contract VaultControllerMock is VaultController {
    constructor(
        ERC20 _CVX,
        address _CVX_LOCKER,
        address _VOTIUM_MULTI_MERKLE_STASH,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    )
        VaultController(
            _CVX,
            _CVX_LOCKER,
            _VOTIUM_MULTI_MERKLE_STASH,
            _EPOCH_DEPOSIT_DURATION,
            _CVX_LOCK_DURATION
        )
    {}

    function createLockedCvxVault(uint256 epoch) external {
        _createLockedCvxVault(epoch);
    }

    function createVoteCvxVault(uint256 epoch) external {
        _createVoteCvxVault(epoch);
    }

    /**
        @notice Restricted to VaultController to ensure reward added on VoteCvxVault
    */
    function mintVoteCvx(address to, uint256 amount) external {
        _mintVoteCvx(to, amount);
    }
}
