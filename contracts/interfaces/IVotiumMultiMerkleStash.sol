// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

interface IVotiumMultiMerkleStash {
    function claim(
        address token,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external;
}
