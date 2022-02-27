// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IConvexToken is IERC20 {
    function updateOperator() external;

    function mint(address _to, uint256 _amount) external;
}
