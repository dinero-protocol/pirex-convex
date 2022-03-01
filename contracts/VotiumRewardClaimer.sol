// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultController} from "./VaultController.sol";
import {LockedCvxVault} from "./LockedCvxVault.sol";
import {VoteCvxVault} from "./VoteCvxVault.sol";
import {IVotiumMultiMerkleStash} from "./interfaces/IVotiumMultiMerkleStash.sol";

contract VotiumRewardClaimer is Initializable {
    using SafeERC20 for ERC20;

    VaultController public VAULT_CONTROLLER;
    LockedCvxVault public LOCKED_CVX_VAULT;
    VoteCvxVault[8] public VOTE_CVX_VAULTS;
    IVotiumMultiMerkleStash public VOTIUM_MULTI_MERKLE_STASH;

    mapping(uint256 => uint256) public voteCvxIndexesByEpoch;

    event ClaimedVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        uint256 amountTransferred,
        address voteCvxVault
    );

    error ZeroAddress();

    function initialize(
        address _VAULT_CONTROLLER,
        address _LOCKED_CVX_VAULT,
        address _VOTIUM_MULTI_MERKLE_STASH,
        address[8] memory _VOTE_CVX_VAULTS,
        uint256[8] memory voteEpochs
    ) external initializer {
        if (_VAULT_CONTROLLER == address(0)) revert ZeroAddress();
        VAULT_CONTROLLER = VaultController(_VAULT_CONTROLLER);

        if (_LOCKED_CVX_VAULT == address(0)) revert ZeroAddress();
        LOCKED_CVX_VAULT = LockedCvxVault(_LOCKED_CVX_VAULT);

        if (_VOTIUM_MULTI_MERKLE_STASH == address(0)) revert ZeroAddress();
        VOTIUM_MULTI_MERKLE_STASH = IVotiumMultiMerkleStash(
            _VOTIUM_MULTI_MERKLE_STASH
        );

        unchecked {
            for (uint8 i; i < 8; ++i) {
                if (_VOTE_CVX_VAULTS[i] == address(0)) revert ZeroAddress();
                VOTE_CVX_VAULTS[i] = VoteCvxVault(_VOTE_CVX_VAULTS[i]);
                voteCvxIndexesByEpoch[voteEpochs[i]] = i;
            }
        }
    }

    /**
        @notice Claim Votium reward
        @param  token        address    Reward token address
        @param  index        uint256    Merkle tree node index
        @param  amount       uint256    Reward token amount
        @param  merkleProof  bytes32[]  Merkle proof
    */
    function claimVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external {
        // Validates token, index, amount, and merkleProof
        VOTIUM_MULTI_MERKLE_STASH.claim(
            token,
            index,
            address(this),
            amount,
            merkleProof
        );

        // Access the VoteCvxVault for the current epoch
        VoteCvxVault voteCvxVault = VOTE_CVX_VAULTS[
            voteCvxIndexesByEpoch[VAULT_CONTROLLER.getCurrentEpoch()]
        ];

        // Use token balance instead of `amount` to account for tokens with fees
        uint256 balanceAfterClaim = ERC20(token).balanceOf(address(this));

        // Transfer rewards to VoteCvxVault, which can be claimed by vault shareholders
        ERC20(token).safeTransfer(address(voteCvxVault), balanceAfterClaim);

        // Add reward so that VoteCvxVault can track and distribute rewards
        voteCvxVault.addReward(token);

        emit ClaimedVotiumReward(
            token,
            index,
            amount,
            balanceAfterClaim,
            address(voteCvxVault)
        );
    }
}
