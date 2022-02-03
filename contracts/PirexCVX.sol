// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

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
    }

    address public cvxLocker;
    address public cvx;
    uint256 public depositDuration;

    mapping(uint256 => Deposit) public deposits;

    event Deposited(uint256 amount, uint256 spendRatio, uint256 currentEpoch, uint256 totalAmount, uint256 lockExpiry);

    constructor(address _cvxLocker, address _cvx, uint256 _depositDuration) {
        require(_cvxLocker != address(0), "Invalid _cvxLocker");
        cvxLocker = _cvxLocker;

        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;

        require(_depositDuration > 0, "Invalid _depositDuration");
        depositDuration = _depositDuration;
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

        // Periods during which users can deposit CVX are every 2 weeks (i.e. epochs)
        uint256 currentEpoch = (block.timestamp / depositDuration) * depositDuration;
        Deposit storage d = deposits[currentEpoch];
        d.amount = d.amount + amount;
        
        // CVX can be withdrawn 4 months after the end of the epoch
        d.lockExpiry = currentEpoch + depositDuration + 17 weeks;

        emit Deposited(amount, spendRatio, currentEpoch, d.amount, d.lockExpiry);
    }
}
