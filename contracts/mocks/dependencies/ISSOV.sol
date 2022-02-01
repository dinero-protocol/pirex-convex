//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

interface ISSOV {
    function epochStrikeTokens(uint256 epoch, uint256 strike)
        external
        view
        returns (address);

    function getAddress(bytes32 name) external view returns (address);

    function currentEpoch() external view returns (uint256);

    function epochStrikes(uint256 epoch, uint256 strikeIndex)
        external
        view
        returns (uint256);

    function settle(
        uint256 strikeIndex,
        uint256 amount,
        uint256 epoch
    ) external returns (uint256);
}