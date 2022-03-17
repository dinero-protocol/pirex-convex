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
    bytes32 public immutable TREASURY_ROLE = bytes32(bytes("TREASURY"));
    bytes32 public immutable REVENUE_LOCKERS_ROLE =
        bytes32(bytes("REVENUE_LOCKERS"));
    bytes32 public immutable CONTRIBUTORS_ROLE = bytes32(bytes("CONTRIBUTORS"));

    // Configurable fee recipient addresses
    address public treasury;
    address public revenueLockers;
    address public contributors;

    // Configurable fee recipient percent-share
    uint8 public treasuryPercent = 25;
    uint8 public revenueLockersPercent = 50;
    uint8 public contributorsPercent = 25;

    event SetFeeRecipient(FeeRecipient f, address recipient);
    event SetFeePercents(
        uint8 _treasuryPercent,
        uint8 _revenueLockersPercent,
        uint8 _contributorsPercent
    );

    error ZeroAddress();
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
        _grantRole(TREASURY_ROLE, _treasury);
        _grantRole(REVENUE_LOCKERS_ROLE, _revenueLockers);
        _grantRole(CONTRIBUTORS_ROLE, _contributors);
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
            _revokeRole(TREASURY_ROLE, treasury);
            treasury = recipient;
            _grantRole(TREASURY_ROLE, recipient);
            return;
        }

        if (f == FeeRecipient.RevenueLockers) {
            _revokeRole(REVENUE_LOCKERS_ROLE, revenueLockers);
            revenueLockers = recipient;
            _grantRole(REVENUE_LOCKERS_ROLE, recipient);
            return;
        }

        _revokeRole(CONTRIBUTORS_ROLE, contributors);
        contributors = recipient;
        _grantRole(CONTRIBUTORS_ROLE, recipient);
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
}
