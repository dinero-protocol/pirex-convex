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
    event SetMigration(
        address executor,
        address recipient,
        address[] tokens,
        uint256[] amounts
    );

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetMigrationExecutorNotAuthorized() external {
        vm.expectRevert(
            "AccessControl: account 0x6ecbe1db9ef729cbe972c83fb886247691fb6beb is missing role 0x0000000000000000000000000000000000000000000000000000000000000000"
        );
        vm.prank(0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb);
        pirexCvx.setMigrationExecutor(address(this));
    }

    /**
        @notice Test tx reversion if contract is not paused
     */
    function testCannotSetMigrationExecutorNotPaused() external {
        vm.expectRevert(bytes("Pausable: not paused"));
        pirexCvx.setMigrationExecutor(address(0));
    }

    /**
        @notice Test tx reversion if executor is the zero address
     */
    function testCannotSetMigrationExecutorZeroAddress() external {
        pirexCvx.setPauseState(true);
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);
        pirexCvx.setMigrationExecutor(address(0));
    }

    /**
        @notice Test setting the migration executor
     */
    function testSetMigrationExecutor() external {
        address expectedExector = address(this);
        address[] memory expectedTokens = new address[](0);
        uint256[] memory expectedAmounts = new uint256[](0);

        vm.expectEmit(false, false, false, true);

        emit SetMigration(
            expectedExector,
            address(0),
            expectedTokens,
            expectedAmounts
        );

        pirexCvx.setPauseState(true);
        pirexCvx.setMigrationExecutor(expectedExector);

        (address executor, , , ) = pirexCvx.getMigration();

        assertEq(executor, expectedExector);
    }
}
