// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract FeePool is AccessControl, ReentrancyGuard {
    using SafeERC20 for ERC20;

    enum FeeRecipient {
        Treasury,
        RevenueLockers,
        Contributors
    }

    uint8 public immutable PERCENT_DENOMINATOR = 100;
    bytes32 public immutable FEE_DISTRIBUTOR_ROLE =
        bytes32(bytes("FEE_DISTRIBUTOR"));

    // Configurable fee recipient addresses
    address public treasury;
    address public revenueLockers;
    address public contributors;

    // Configurable fee recipient percent-share
    uint8 public treasuryPercent = 25;
    uint8 public revenueLockersPercent = 50;
    uint8 public contributorsPercent = 25;

    event GrantFeeDistributorRole(address distributor);
    event RevokeFeeDistributorRole(address distributor);
    event SetFeeRecipient(FeeRecipient f, address recipient);
    event SetFeePercents(
        uint8 _treasuryPercent,
        uint8 _revenueLockersPercent,
        uint8 _contributorsPercent
    );
    event DepositFee(address token, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error NotFeeDistributor();
    error InvalidFeePercent();

    /**
        @param  _treasury        address  Redacted treasury
        @param  _revenueLockers  address  rlBTRFLY fee distributor
        @param  _contributors    address  Contributor fee distributor
     */
    constructor(
        address _treasury,
        address _revenueLockers,
        address _contributors
    ) {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;

        if (_revenueLockers == address(0)) revert ZeroAddress();
        revenueLockers = _revenueLockers;

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

        if (f == FeeRecipient.RevenueLockers) {
            revenueLockers = recipient;
            return;
        }

        contributors = recipient;
    }

    /** 
        @notice Set fee percents
        @param  _treasuryPercent        uint8  Treasury fee percent
        @param  _revenueLockersPercent  uint8  RevenueLockers fee percent
        @param  _contributorsPercent    uint8  Contributors fee percent
     */
    function setFeePercents(
        uint8 _treasuryPercent,
        uint8 _revenueLockersPercent,
        uint8 _contributorsPercent
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            (_treasuryPercent +
                _revenueLockersPercent +
                _contributorsPercent) != 100
        ) revert InvalidFeePercent();

        treasuryPercent = _treasuryPercent;
        revenueLockersPercent = _revenueLockersPercent;
        contributorsPercent = _contributorsPercent;

        emit SetFeePercents(
            _treasuryPercent,
            _revenueLockersPercent,
            _contributorsPercent
        );
    }

    /** 
        @notice Distribute fees
        @param  token   address  Fee token
        @param  amount  uint256  Fee token amount
     */
    function distributeFees(address token, uint256 amount)
        external
        nonReentrant
        onlyRole(FEE_DISTRIBUTOR_ROLE)
    {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        emit DepositFee(token, amount);

        ERC20 t = ERC20(token);

        // Favoring push over pull to reduce accounting complexity for different tokens
        t.safeTransfer(
            treasury,
            (amount * treasuryPercent) / PERCENT_DENOMINATOR
        );
        t.safeTransfer(
            revenueLockers,
            (amount * revenueLockersPercent) / PERCENT_DENOMINATOR
        );
        t.safeTransfer(
            contributors,
            (amount * contributorsPercent) / PERCENT_DENOMINATOR
        );
    }
}
