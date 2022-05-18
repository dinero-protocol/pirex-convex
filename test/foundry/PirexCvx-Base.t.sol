// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxBaseTest is Test, HelperContract {
    event SetContract(PirexCvx.Contract indexed c, address contractAddress);

    function _validateSetContract(PirexCvx.Contract c, bytes4 selector)
        internal
    {
        // Fetch the currently set contract address
        (, bytes memory res1) = address(pirexCvx).call(
            abi.encodeWithSelector(selector)
        );
        address oldContract = abi.decode(res1, (address));
        address newContract = address(this);

        assertFalse(oldContract == newContract);

        vm.expectEmit(true, false, false, true);

        emit SetContract(c, newContract);

        // Set the new contract address and validate
        pirexCvx.setContract(c, newContract);

        (, bytes memory res2) = address(pirexCvx).call(
            abi.encodeWithSelector(selector)
        );
        address updatedContract = abi.decode(res2, (address));

        assertEq(updatedContract, newContract);
    }

    /*//////////////////////////////////////////////////////////////
                        setContract TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if caller is not authorized
     */
    function testCannotSetContractNotAuthorized() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setContract(PirexCvx.Contract.UnionPirexVault, address(this));
    }

    /**
        @notice Test tx reversion if the specified address is the zero address
     */
    function testCannotSetContractZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.setContract(PirexCvx.Contract.UnionPirexVault, address(0));
    }

    /**
        @notice Test setting PxCvx
     */
    function testSetContractPxCvx() external {
        _validateSetContract(PirexCvx.Contract.PxCvx, pirexCvx.pxCvx.selector);
    }

    /**
        @notice Test setting PirexFees
     */
    function testSetContractPirexFees() external {
        _validateSetContract(
            PirexCvx.Contract.PirexFees,
            pirexCvx.pirexFees.selector
        );
    }

    /**
        @notice Test setting UpCvx
     */
    function testSetContractUpCvx() external {
        _validateSetContract(PirexCvx.Contract.UpCvx, pirexCvx.upCvx.selector);
    }

    /**
        @notice Test setting SpCvx
     */
    function testSetContractSpCvx() external {
        _validateSetContract(PirexCvx.Contract.SpCvx, pirexCvx.spCvx.selector);
    }

    /**
        @notice Test setting RpCvx
     */
    function testSetContractRpCvx() external {
        _validateSetContract(PirexCvx.Contract.RpCvx, pirexCvx.rpCvx.selector);
    }

    /**
        @notice Test setting VpCvx
     */
    function testSetContractVpCvx() external {
        _validateSetContract(PirexCvx.Contract.VpCvx, pirexCvx.vpCvx.selector);
    }

    /**
        @notice Test setting UnionPirexVault
     */
    function testSetContractUnionPirexVault() external {
        address oldUnion = address(pirexCvx.unionPirex());
        address newUnion = address(this);

        _validateSetContract(
            PirexCvx.Contract.UnionPirexVault,
            pirexCvx.unionPirex.selector
        );

        // Check the allowances
        assertEq(pxCvx.allowance(address(pirexCvx), oldUnion), 0);
        assertEq(
            pxCvx.allowance(address(pirexCvx), newUnion),
            type(uint256).max
        );
    }

    /*//////////////////////////////////////////////////////////////
                        getCurrentEpoch TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test getting current epoch
     */
    function testGetCurrentEpoch() external {
        uint256 expectedEpoch = (block.timestamp / EPOCH_DURATION) *
            EPOCH_DURATION;

        assertEq(pirexCvx.getCurrentEpoch(), expectedEpoch);
    }
}
