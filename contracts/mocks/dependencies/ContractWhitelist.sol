//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {Ownable} from './Ownable.sol';

/// @title ContractWhitelist
/// @author witherblock
/// @notice A helper contract that lets you add a list of whitelisted contracts that should be able to interact with restricited functions
abstract contract ContractWhitelist is Ownable {
    /// @dev contract => whitelisted or not
    mapping(address => bool) public whitelistedContracts;

    /*==== SETTERS ====*/

    /// @dev add to the contract whitelist
    /// @param _contract the address of the contract to add to the contract whitelist
    /// @return whether the contract was successfully added to the whitelist
    function addToContractWhitelist(address _contract)
        external
        onlyOwner
        returns (bool)
    {
        require(
            isContract(_contract),
            'ContractWhitelist: Address must be a contract address'
        );
        require(
            !whitelistedContracts[_contract],
            'ContractWhitelist: Contract already whitelisted'
        );

        whitelistedContracts[_contract] = true;

        emit AddToContractWhitelist(_contract);

        return true;
    }

    /// @dev remove from  the contract whitelist
    /// @param _contract the address of the contract to remove from the contract whitelist
    /// @return whether the contract was successfully removed from the whitelist
    function removeFromContractWhitelist(address _contract)
        external
        returns (bool)
    {
        require(
            whitelistedContracts[_contract],
            'ContractWhitelist: Contract not whitelisted'
        );

        whitelistedContracts[_contract] = false;

        emit RemoveFromContractWhitelist(_contract);

        return true;
    }

    /* ========== MODIFIERS ========== */

    // Modifier is eligible sender modifier
    modifier isEligibleSender() {
        if (isContract(msg.sender))
            require(
                whitelistedContracts[msg.sender],
                'ContractWhitelist: Contract must be whitelisted'
            );
        _;
    }

    /*==== VIEWS ====*/

    /// @dev checks for contract or eoa addresses
    /// @param addr the address to check
    /// @return whether the passed address is a contract address
    function isContract(address addr) public view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(addr)
        }
        return size > 0;
    }

    /*==== EVENTS ====*/

    event AddToContractWhitelist(address indexed _contract);

    event RemoveFromContractWhitelist(address indexed _contract);
}