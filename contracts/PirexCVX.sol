// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "./base/Ownable.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {SafeERC20} from "./utils/SafeERC20.sol";

interface ICvxLocker {
    function lock(
        address _account,
        uint256 _amount,
        uint256 _spendRatio
    ) external;
}

contract PirexCVX is Ownable {
    using SafeERC20 for IERC20;

    struct Deposit {
        uint256 amount;
        uint256 lockExpiry;
        mapping(uint256 => mapping(address => uint256)) rewards;
    }

    address public cvxLocker;
    address public cvx;
    uint256 public currentEpoch;
    uint256 public depositDuration;

    mapping(uint256 => Deposit) public deposits;

    event Deposited(uint256 amount, uint256 spendRatio);

    constructor(address _cvxLocker, address _cvx, uint256 _depositDuration) {
        require(_cvxLocker != address(0), "Invalid _cvxLocker");
        cvxLocker = _cvxLocker;

        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;

        require(_depositDuration > 0, "Invalid _depositDuration");
        depositDuration = _depositDuration;

        currentEpoch = (block.timestamp / depositDuration) * depositDuration;
    }

    function deposit(
        uint256 amount,
        uint256 spendRatio
    ) external {
        require(amount > 0, "Invalid amount");

        // Necessary as CvxLocker's lock method uses msg.sender when transferring
        IERC20(cvx).safeTransferFrom(msg.sender, address(this), amount);

        IERC20(cvx).safeIncreaseAllowance(cvxLocker, amount);
        ICvxLocker(cvxLocker).lock(address(this), amount, spendRatio);

        emit Deposited(amount, spendRatio);
    }
}
