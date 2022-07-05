// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

// Used solely for testing curvePool related stuffs that require some method calls
contract CurvePoolMock {
    function coins(uint256) external pure returns (address) {
        return address(0);
    }
}
