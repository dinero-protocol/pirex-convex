// SPDX-License-Identifier: MIT
// Votium Address Registry

pragma solidity 0.8.12;

interface IVotiumAddressRegistry {
    function setRegistry(address _to) external;

    function setToExpire() external;

    function batchAddressCheck(address[] memory accounts)
        external
        view
        returns (address[] memory);

    function optOutLength() external view returns (uint256);

    function optOutPage(uint256 size, uint256 page)
        external
        view
        returns (address[] memory);

    function forwardLength() external view returns (uint256);

    function forwardPage(uint256 size, uint256 page)
        external
        view
        returns (address[] memory);

    function currentEpoch() external view returns (uint256);

    function nextEpoch() external view returns (uint256);

    function execute(
        address _to,
        uint256 _value,
        bytes calldata _data
    ) external returns (bool, bytes memory);

    function forceRegistry(address _from, address _to) external;

    function forceToExpire(address _from) external;
}
