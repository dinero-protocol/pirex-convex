// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface IETHVolatilityOracle {
    function getVolatility(uint256 strike) external view returns (uint256);
}