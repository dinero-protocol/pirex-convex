// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxEmergency is Test, HelperContract {
    address private notAdmin = 0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb;
    bytes private notAuthorizedErrorMsg =
        bytes(
            "AccessControl: account 0x6ecbe1db9ef729cbe972c83fb886247691fb6beb is missing role 0x0000000000000000000000000000000000000000000000000000000000000000"
        );
    PirexCvx.EmergencyMigration private e;

    event SetEmergencyExecutor(address _emergencyExecutor);
    event SetEmergencyMigration(
        PirexCvx.EmergencyMigration _emergencyMigration
    );

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetEmergencyExecutorNotAuthorized() external {
        vm.expectRevert(notAuthorizedErrorMsg);
        vm.prank(notAdmin);
        pirexCvx.setEmergencyExecutor(address(this));
    }

    /**
        @notice Test tx reversion if contract is not paused
     */
    function testCannotSetEmergencyExecutorNotPaused() external {
        assertEq(pirexCvx.paused(), false);

        vm.expectRevert(bytes("Pausable: not paused"));
        pirexCvx.setEmergencyExecutor(address(0));
    }

    /**
        @notice Test tx reversion if executor is the zero address
     */
    function testCannotSetEmergencyExecutorZeroAddress() external {
        pirexCvx.setPauseState(true);
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);
        pirexCvx.setEmergencyExecutor(address(0));
    }

    /**
        @notice Test tx reversion if executor is already set
     */
    function testCannotSetEmergencyExecutorAlreadySet() external {
        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));

        assertEq(pirexCvx.getEmergencyExecutor(), address(this));

        vm.expectRevert(PirexCvx.AlreadySet.selector);
        pirexCvx.setEmergencyExecutor(address(this));
    }

    /**
        @notice Test setting the emergency executor
     */
    function testSetEmergencyExecutor() external {
        address emergencyExecutor = address(this);

        vm.expectEmit(false, false, false, true);

        emit SetEmergencyExecutor(emergencyExecutor);

        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(emergencyExecutor);

        assertEq(pirexCvx.getEmergencyExecutor(), emergencyExecutor);
    }

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetEmergencyMigrationNotAuthorized() external {
        vm.expectRevert(notAuthorizedErrorMsg);
        vm.prank(notAdmin);
        pirexCvx.setEmergencyMigration(e);
    }

    /**
        @notice Test tx reversion if contract is not paused
     */
    function testCannotSetEmergencyMigrationNotPaused() external {
        assertEq(pirexCvx.paused(), false);

        vm.expectRevert("Pausable: not paused");
        pirexCvx.setEmergencyMigration(e);
    }

    /**
        @notice Test tx reversion if emergency executor is zero address
     */
    function testCannotSetEmergencyMigrationNoEmergencyExecutor() external {
        assertEq(pirexCvx.getEmergencyExecutor(), address(0));

        pirexCvx.setPauseState(true);
        vm.expectRevert(PirexCvx.NoEmergencyExecutor.selector);
        pirexCvx.setEmergencyMigration(e);
    }

    /**
        @notice Test tx reversion if struct arg `recipient` member is zero address
     */
    function testCannotSetEmergencyMigrationNoRecipient() external {
        assertEq(e.recipient, address(0));

        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));
        vm.expectRevert(PirexCvx.InvalidEmergencyMigration.selector);
        pirexCvx.setEmergencyMigration(e);
    }

    /**
        @notice Test tx reversion if struct arg `tokens` length is zero
     */
    function testCannotSetEmergencyMigrationNoTokens() external {
        assertEq(e.tokens.length, 0);

        e.recipient = address(this);

        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));
        vm.expectRevert(PirexCvx.InvalidEmergencyMigration.selector);
        pirexCvx.setEmergencyMigration(e);
    }

    /**
        @notice Test setting the emergency migration data
     */
    function testSetEmergencyMigration() external {
        e.recipient = address(this);
        e.tokens = new address[](1);
        e.tokens[0] = address(CVX);

        vm.expectEmit(false, false, false, true);

        emit SetEmergencyMigration(e);

        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));
        pirexCvx.setEmergencyMigration(e);

        (address recipient, address[] memory tokens) = pirexCvx
            .getEmergencyMigration();

        assertEq(recipient, e.recipient);
        assertEq(tokens[0], e.tokens[0]);
        assertEq(tokens.length, e.tokens.length);
    }
}
