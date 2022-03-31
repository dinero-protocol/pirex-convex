// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PirexFees is AccessControl {
    using SafeERC20 for ERC20;

    enum FeeRecipient {
        Treasury,
        Contributors
    }

    bytes32 public immutable FEE_DISTRIBUTOR_ROLE = bytes32("FEE_DISTRIBUTOR");

    uint8 public constant PERCENT_DENOMINATOR = 100;

    // Configurable fee recipient percent-share
    uint8 public treasuryPercent = 75;
    uint8 public contributorsPercent = 25;

    // Configurable fee recipient addresses
    address public treasury;
    address public contributors;

    event GrantFeeDistributorRole(address distributor);
    event RevokeFeeDistributorRole(address distributor);
    event SetFeeRecipient(FeeRecipient f, address recipient);
    event SetFeePercents(uint8 _treasuryPercent, uint8 _contributorsPercent);
    event DistributeFees(address token, uint256 amount);

    error ZeroAddress();
    error NotFeeDistributor();
    error InvalidFeePercent();

    /**
        @param  _treasury      address  Redacted treasury
        @param  _contributors  address  Pirex contributor multisig
     */
    constructor(address _treasury, address _contributors) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;

        if (_contributors == address(0)) revert ZeroAddress();
        contributors = _contributors;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
        @notice Grant the distributor role to an address
        @param  distributor  address  Address to grant the distributor role
     */
    function grantFeeDistributorRole(address distributor)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (distributor == address(0)) revert ZeroAddress();

        _grantRole(FEE_DISTRIBUTOR_ROLE, distributor);

        emit GrantFeeDistributorRole(distributor);
    }

    /**
     @notice Revoke the distributor role from an address
     @param  distributor  address  Address to revoke the distributor role
  */
    function revokeFeeDistributorRole(address distributor)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (hasRole(FEE_DISTRIBUTOR_ROLE, distributor) == false)
            revert NotFeeDistributor();

        _revokeRole(FEE_DISTRIBUTOR_ROLE, distributor);

        emit RevokeFeeDistributorRole(distributor);
    }

    /** 
        @notice Set a fee recipient address
        @param  f          FeeRecipient  FeeRecipient enum
        @param  recipient  address       Fee recipient address
     */
    function setFeeRecipient(FeeRecipient f, address recipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (recipient == address(0)) revert ZeroAddress();

        emit SetFeeRecipient(f, recipient);

        if (f == FeeRecipient.Treasury) {
            treasury = recipient;
            return;
        }

        contributors = recipient;
    }

    /** 
        @notice Set fee percents
        @param  _treasuryPercent      uint8  Treasury fee percent
        @param  _contributorsPercent  uint8  Contributors fee percent
     */
    function setFeePercents(uint8 _treasuryPercent, uint8 _contributorsPercent)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if ((_treasuryPercent + _contributorsPercent) != 100)
            revert InvalidFeePercent();

        treasuryPercent = _treasuryPercent;
        contributorsPercent = _contributorsPercent;

        emit SetFeePercents(_treasuryPercent, _contributorsPercent);
    }

    /** 
        @notice Distribute fees
        @param  from    address  Fee source
        @param  token   address  Fee token
        @param  amount  uint256  Fee token amount
     */
    function distributeFees(
        address from,
        address token,
        uint256 amount
    ) external onlyRole(FEE_DISTRIBUTOR_ROLE) {
        emit DistributeFees(token, amount);

        ERC20 t = ERC20(token);

        // Favoring push over pull to reduce accounting complexity for different tokens
        t.safeTransferFrom(
            from,
            treasury,
            (amount * treasuryPercent) / PERCENT_DENOMINATOR
        );

        t.safeTransferFrom(
            from,
            contributors,
            (amount * contributorsPercent) / PERCENT_DENOMINATOR
        );
    }
}
