// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {VaultController} from "../VaultController.sol";

contract VaultControllerMock is VaultController {
    constructor(
        ERC20 _CVX,
        address _CVX_LOCKER,
        address _VOTIUM_MULTI_MERKLE_STASH,
        address _VOTIUM_ADDRESS_REGISTRY,
        uint256 _EPOCH_DEPOSIT_DURATION,
        uint256 _CVX_LOCK_DURATION
    )
        VaultController(
            _CVX,
            _CVX_LOCKER,
            _VOTIUM_MULTI_MERKLE_STASH,
            _VOTIUM_ADDRESS_REGISTRY,
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

    function mintVoteCvx(uint256 startingVoteEpoch, address to, uint256 amount) external {
        _mintVoteCvx(startingVoteEpoch, to, amount);
    }
}
