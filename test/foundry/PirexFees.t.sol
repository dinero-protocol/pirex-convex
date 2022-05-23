// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {PirexFees} from "contracts/PirexFees.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexFeesTest is Test, HelperContract {
    uint8 public constant MAX_TREASURY_PERCENT = 75;

    event GrantFeeDistributorRole(address distributor);
    event RevokeFeeDistributorRole(address distributor);
    event SetFeeRecipient(PirexFees.FeeRecipient f, address recipient);
    event SetTreasuryPercent(uint8 _treasuryPercent);
    event DistributeFees(address token, uint256 amount);

    function _getRoleErrorMessage(address target, bytes32 role)
        internal
        pure
        returns (bytes memory)
    {
        return
            abi.encodePacked(
                "AccessControl: account ",
                Strings.toHexString(uint160(target), 20),
                " is missing role ",
                Strings.toHexString(uint256(role), 32)
            );
    }

    /*//////////////////////////////////////////////////////////////
                        grantFeeDistributorRole TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotGrantFeeDistributorRoleNotAuthorized() external {
        vm.expectRevert(
            _getRoleErrorMessage(
                secondaryAccounts[0],
                pirexFees.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(secondaryAccounts[0]);
        pirexFees.grantFeeDistributorRole(address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotGrantFeeDistributorRoleZeroAddress() external {
        vm.expectRevert(PirexFees.ZeroAddress.selector);
        pirexFees.grantFeeDistributorRole(address(0));
    }

    /**
        @notice Test granting the fee distributor role
     */
    function testGrantFeeDistributorRole() external {
        address newDistributor = secondaryAccounts[0];
        assertEq(
            pirexFees.hasRole(pirexFees.FEE_DISTRIBUTOR_ROLE(), newDistributor),
            false
        );

        vm.expectEmit(false, false, false, true);
        emit GrantFeeDistributorRole(newDistributor);

        pirexFees.grantFeeDistributorRole(newDistributor);
        assertEq(
            pirexFees.hasRole(pirexFees.FEE_DISTRIBUTOR_ROLE(), newDistributor),
            true
        );
    }

    /*//////////////////////////////////////////////////////////////
                        revokeFeeDistributorRole TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotRevokeFeeDistributorRoleNotAuthorized() external {
        vm.expectRevert(
            _getRoleErrorMessage(
                secondaryAccounts[0],
                pirexFees.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(secondaryAccounts[0]);
        pirexFees.revokeFeeDistributorRole(address(this));
    }

    /**
        @notice Test tx reversion if the specified address does not have the fee distributor role
     */
    function testCannotRevokeFeeDistributorRoleNotFeeDistributor() external {
        vm.expectRevert(PirexFees.NotFeeDistributor.selector);
        pirexFees.revokeFeeDistributorRole(address(0));
    }

    /**
        @notice Test revoking the fee distributor role
     */
    function testRevokeFeeDistributorRole() external {
        address newDistributor = secondaryAccounts[0];

        // Grant the role first before revoking it
        pirexFees.grantFeeDistributorRole(newDistributor);
        assertEq(
            pirexFees.hasRole(pirexFees.FEE_DISTRIBUTOR_ROLE(), newDistributor),
            true
        );

        vm.expectEmit(false, false, false, true);
        emit RevokeFeeDistributorRole(newDistributor);

        pirexFees.revokeFeeDistributorRole(newDistributor);
        assertEq(
            pirexFees.hasRole(pirexFees.FEE_DISTRIBUTOR_ROLE(), newDistributor),
            false
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setFeeRecipient TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetFeeRecipientNotAuthorized() external {
        vm.expectRevert(
            _getRoleErrorMessage(
                secondaryAccounts[0],
                pirexFees.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(secondaryAccounts[0]);
        pirexFees.setFeeRecipient(
            PirexFees.FeeRecipient.Contributors,
            address(this)
        );
    }

    /**
        @notice Test tx reversion if the recipient is the zero address
     */
    function testCannotSetFeeRecipientZeroAddress() external {
        vm.expectRevert(PirexFees.ZeroAddress.selector);
        pirexFees.setFeeRecipient(
            PirexFees.FeeRecipient.Contributors,
            address(0)
        );
    }

    /**
        @notice Test setting the fee recipient
        @param  fVal  uint8  Integer representation of the recipient enum
     */
    function testSetFeeRecipient(uint8 fVal) external {
        vm.assume(fVal <= uint8(type(PirexFees.FeeRecipient).max));

        PirexFees.FeeRecipient f = PirexFees.FeeRecipient(fVal);
        address recipient = secondaryAccounts[0];

        vm.expectEmit(false, false, false, true);
        emit SetFeeRecipient(f, recipient);

        pirexFees.setFeeRecipient(f, recipient);
        assertEq(
            (
                f == PirexFees.FeeRecipient.Treasury
                    ? pirexFees.treasury()
                    : pirexFees.contributors()
            ),
            recipient
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setTreasuryPercent TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetTreasuryPercentNotAuthorized() external {
        vm.expectRevert(
            _getRoleErrorMessage(
                secondaryAccounts[0],
                pirexFees.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(secondaryAccounts[0]);
        pirexFees.setTreasuryPercent(MAX_TREASURY_PERCENT);
    }

    /**
        @notice Test tx reversion if the treasury percent is invalid
     */
    function testCannotSetTreasuryPercentInvalidFeePercent() external {
        // The percentage is invalid if > maxTreasuryPercent
        vm.expectRevert(PirexFees.InvalidFeePercent.selector);
        pirexFees.setTreasuryPercent(MAX_TREASURY_PERCENT + 1);
    }

    /**
        @notice Test setting the treasury percent
        @param  percent  uint8  Treasury percent
     */
    function testSetTreasuryPercent(uint8 percent) external {
        vm.assume(percent <= MAX_TREASURY_PERCENT);

        vm.expectEmit(false, false, false, true);
        emit SetTreasuryPercent(percent);

        pirexFees.setTreasuryPercent(percent);
        assertEq(pirexFees.treasuryPercent(), percent);
    }

    /*//////////////////////////////////////////////////////////////
                        distributeFees TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized as fee distributor
     */
    function testCannotDistributeFeesNotDistributor() external {
        vm.expectRevert(
            _getRoleErrorMessage(
                secondaryAccounts[0],
                pirexFees.FEE_DISTRIBUTOR_ROLE()
            )
        );
        vm.prank(secondaryAccounts[0]);
        pirexFees.distributeFees(secondaryAccounts[0], address(CVX), 0);
    }

    /**
        @notice Test distributing fees
        @param  amount  uint256  Amount to be distributed
     */
    function testDistributeFees(uint256 amount) external {
        vm.assume(amount < 10000e18);

        address from = secondaryAccounts[0];
        address treasury = secondaryAccounts[1];
        address contributors = secondaryAccounts[2];
        address token = address(CVX);

        // Set the treasury and contributors recipients
        pirexFees.setFeeRecipient(PirexFees.FeeRecipient.Treasury, treasury);
        pirexFees.setFeeRecipient(
            PirexFees.FeeRecipient.Contributors,
            contributors
        );

        // Mint and approve tokens proportionally to the required amount
        _mintCvx(address(from), amount);
        vm.prank(from);
        CVX.approve(address(pirexFees), amount);

        // Grant distributor role to the primary account so it can call the distributeFees method
        pirexFees.grantFeeDistributorRole(address(this));

        vm.expectEmit(false, false, false, true);
        emit DistributeFees(token, amount);

        pirexFees.distributeFees(from, token, amount);

        uint256 expectedTreasuryFees = (amount * pirexFees.treasuryPercent()) /
            pirexFees.PERCENT_DENOMINATOR();
        uint256 expectedContributorsFees = amount - expectedTreasuryFees;

        // Check the latest CVX balances for all affected parties
        assertEq(CVX.balanceOf(from), 0);
        assertEq(CVX.balanceOf(treasury), expectedTreasuryFees);
        assertEq(CVX.balanceOf(contributors), expectedContributorsFees);
    }
}
