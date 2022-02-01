// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IFeeStrategy {
    function calculatePurchaseFees(
        uint256,
        uint256,
        uint256
    ) external view returns (uint256);

    function calculateSettlementFees(
        uint256,
        uint256,
        uint256
    ) external view returns (uint256);
}