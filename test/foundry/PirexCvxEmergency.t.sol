// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxEmergency is Test, ERC20("Test", "TEST", 18), HelperContract {
    PirexCvx.EmergencyMigration private e;

    event SetEmergencyExecutor(address _emergencyExecutor);
    event SetEmergencyMigration(
        PirexCvx.EmergencyMigration _emergencyMigration
    );

    /*//////////////////////////////////////////////////////////////
                        setEmergencyExecutor TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetEmergencyExecutorNotAuthorized() external {
        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        vm.prank(secondaryAccounts[0]);
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

    /*//////////////////////////////////////////////////////////////
                        setEmergencyMigration TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetEmergencyMigrationNotAuthorized() external {
        vm.expectRevert(bytes("Ownable: caller is not the owner"));
        vm.prank(secondaryAccounts[0]);
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

    /*//////////////////////////////////////////////////////////////
                        executeEmergencyMigration TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if contract is not paused
     */
    function testCannotExecuteEmergencyMigrationNotPaused() external {
        assertEq(pirexCvx.paused(), false);

        vm.expectRevert(bytes("Pausable: not paused"));
        pirexCvx.executeEmergencyMigration();
    }

    /**
        @notice Test tx reversion if caller is not the emergency executor
     */
    function testCannotExecuteEmergencyMigrationNotExecutor() external {
        pirexCvx.setPauseState(true);
        vm.expectRevert(PirexCvx.NotAuthorized.selector);
        pirexCvx.executeEmergencyMigration();
    }

    /**
        @notice Test tx reversion if migration recipient is the zero address
     */
    function testCannotExecuteEmergencyMigrationNoRecipient() external {
        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));

        (address recipient, ) = pirexCvx.getEmergencyMigration();

        assertEq(recipient, address(0));

        vm.expectRevert(PirexCvx.InvalidEmergencyMigration.selector);
        pirexCvx.executeEmergencyMigration();
    }

    /**
        @notice Test executing the emergency migration
     */
    function testExecuteEmergencyMigration() external {
        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(address(this));

        address recipient = secondaryAccounts[0];
        e.recipient = recipient;
        e.tokens = new address[](2);
        e.tokens[0] = address(CVX);
        e.tokens[1] = address(this);

        uint256 tokenMintAmount = 1e18;
        uint256 expectedRemainingCvx = 5e17;

        // Manipulate `outstandingRedemptions` and test if migration leaves the amount in-contract
        vm.store(
            address(pirexCvx),
            bytes32(uint256(5)),
            bytes32(expectedRemainingCvx)
        );

        // // Mint tokens for PirexCvx contract
        _mintCvx(address(pirexCvx), tokenMintAmount);
        _mint(address(pirexCvx), tokenMintAmount);

        assertEq(CVX.balanceOf(address(pirexCvx)), tokenMintAmount);
        assertEq(balanceOf[address(pirexCvx)], tokenMintAmount);

        // Ensure that the recipient's balance for CVX and TEST are both 0 prior to the migration
        assertEq(CVX.balanceOf(recipient), 0);
        assertEq(balanceOf[recipient], 0);

        pirexCvx.setEmergencyMigration(e);
        pirexCvx.executeEmergencyMigration();

        assertEq(CVX.balanceOf(address(pirexCvx)), expectedRemainingCvx);
        assertEq(
            CVX.balanceOf(recipient),
            tokenMintAmount - expectedRemainingCvx
        );
        assertEq(balanceOf[address(pirexCvx)], 0);
        assertEq(balanceOf[recipient], tokenMintAmount);
    }
}
