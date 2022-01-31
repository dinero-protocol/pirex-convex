// SPDX-License-Identifier: MIT
pragma solidity ^0.7.5;

import {Ownable} from "./base/Ownable.sol";

contract SSOVWrapperEth is Ownable {
    struct EpochStrike {
        uint256 deposits;
        uint256 funds;
        uint256 dpx;
        uint256 rdpx;
        address token;
        bool withdrawable;
    }

    mapping(bytes32 => EpochStrike) epochStrikes;

    event ConfigureEpochStrike(
        uint256 epoch,
        uint256 strike,
        address token,
        bool withdrawable
    );

    /**
        @notice Configure the epoch-strike by setting the token and withdrawable properties
        @param  epoch         uint256 Epoch
        @param  strike        uint256 Strike
        @param  token         uint256 Deposit token
        @param  withdrawable  bool    Whether funds can be withdrawn
     */
    function configureEpochStrike(
        uint256 epoch,
        uint256 strike,
        address token,
        bool withdrawable
    ) external onlyOwner {
        EpochStrike storage e = epochStrikes[
            keccak256(abi.encode(epoch, strike))
        ];

        // Enables withdrawable to be set w/o specifying token address
        if (token != address(0)) {
            e.token = token;
        }

        e.withdrawable = withdrawable;

        emit ConfigureEpochStrike(epoch, strike, e.token, e.withdrawable);
    }

    /**
        @notice Get epoch-strike
        @param  epoch        uint256 Epoch
        @param  strike       uint256 Strike
        @return deposits     uint256 Total deposits made by users for an epoch-strike
        @return funds        uint256 Total funds withdrawn from Dopex for an epoch-strike
        @return dpx          uint256 Total DPX withdrawn from Dopex for an epoch-strike
        @return rdpx         uint256 Total rDPX withdrawn from Dopex for an epoch-strike
        @return token        address Deposit token
        @return withdrawable bool    Whether funds can be withdrawn
     */
    function getEpochStrike(uint256 epoch, uint256 strike)
        external
        view
        returns (
            uint256 deposits,
            uint256 funds,
            uint256 dpx,
            uint256 rdpx,
            address token,
            bool withdrawable
        )
    {
        EpochStrike memory e = epochStrikes[
            keccak256(abi.encode(epoch, strike))
        ];

        return (e.deposits, e.funds, e.dpx, e.rdpx, e.token, e.withdrawable);
    }
}
