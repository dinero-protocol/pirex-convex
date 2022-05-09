// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/tokens/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxMigration is Test, HelperContract {
    event SetEmergencyExecutor(address _emergencyExecutor);

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetEmergencyExecutorNotAuthorized() external {
        vm.expectRevert(
            "AccessControl: account 0x6ecbe1db9ef729cbe972c83fb886247691fb6beb is missing role 0x0000000000000000000000000000000000000000000000000000000000000000"
        );
        vm.prank(0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb);
        pirexCvx.setEmergencyExecutor(address(this));
    }

    /**
        @notice Test tx reversion if contract is not paused
     */
    function testCannotSetEmergencyExecutorNotPaused() external {
        assertTrue(pirexCvx.paused() == false);

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

        assertTrue(pirexCvx.getEmergencyExecutor() != address(0));

        vm.expectRevert(PirexCvx.AlreadySet.selector);
        pirexCvx.setEmergencyExecutor(address(this));
    }

    /**
        @notice Test setting the migration executor
     */
    function testSetEmergencyExecutor() external {
        address emergencyExecutor = address(this);

        vm.expectEmit(false, false, false, true);

        emit SetEmergencyExecutor(emergencyExecutor);

        pirexCvx.setPauseState(true);
        pirexCvx.setEmergencyExecutor(emergencyExecutor);

        assertEq(pirexCvx.getEmergencyExecutor(), emergencyExecutor);
    }
}
