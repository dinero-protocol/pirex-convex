// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPirexCvx {
    function claimVotiumReward(
        address token,
        uint256 index,
        uint256 amount,
        bytes32[] calldata merkleProof,
        uint256 voteEpoch
    ) external;
}

contract VotiumRewardManager is Ownable {
    using SafeERC20 for IERC20;

    address public pirexCvx;
    address public cvx;

    constructor(address _pirexCvx, address _cvx) {
        require(_pirexCvx != address(0), "Invalid _pirexCvx");
        pirexCvx = _pirexCvx;

        require(_cvx != address(0), "Invalid _cvx");
        cvx = _cvx;
    }

    modifier onlyAuthorized() {
        require(msg.sender == pirexCvx, "Not authorized");
        _;
    }

    /**
        @notice Manage rewards for PirexCvx (extremely basic demo for MVP)
        @param  token             address            Reward token address
        @param  amount            uint256            Reward token amount
        @return managerToken          address        Manager-returned token (e.g. manager converts tokens into cvxCRV)
        @return managerTokenAmount    uint256        Manager-returned token amount
     */
    function manage(address token, uint256 amount)
        external
        onlyAuthorized
        returns (address managerToken, uint256 managerTokenAmount)
    {
        // Transfer tokens from PirexCvx and do something with them (coming later)
        IERC20(token).safeTransferFrom(pirexCvx, address(this), amount);

        // For MVP, mock swapping reward token for CVX
        managerToken = cvx;
        managerTokenAmount = amount;

        IERC20(managerToken).safeTransfer(pirexCvx, managerTokenAmount);
    }
}
