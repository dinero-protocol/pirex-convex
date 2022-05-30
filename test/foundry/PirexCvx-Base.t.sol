// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PirexCvxConvex} from "contracts/PirexCvxConvex.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {HelperContract} from "./HelperContract.sol";

contract PirexCvxBaseTest is Test, HelperContract {
    event SetContract(PirexCvx.Contract indexed c, address contractAddress);
    event InitializeFees(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    );
    event AddDeveloper(address developer);
    event RemoveDeveloper(address developer);

    /**
        @notice Set the new contract
        @param  c            PirexCvx.Contract  Contract enum
        @param  newContract  address            New contract address
     */
    function _setContract(PirexCvx.Contract c, address newContract) internal {
        vm.expectEmit(true, false, false, true);

        emit SetContract(c, newContract);

        // Set the new contract address
        pirexCvx.setContract(c, newContract);
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
        address oldContract = address(pirexCvx.pxCvx());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.PxCvx, newContract);

        address updatedContract = address(pirexCvx.pxCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting PirexFees
     */
    function testSetContractPirexFees() external {
        address oldContract = address(pirexCvx.pirexFees());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.PirexFees, newContract);

        address updatedContract = address(pirexCvx.pirexFees());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting Votium
     */
    function testSetContractVotium() external {
        address oldContract = address(pirexCvx.votiumMultiMerkleStash());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.Votium, newContract);

        address updatedContract = address(pirexCvx.votiumMultiMerkleStash());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting UpxCvx
     */
    function testSetContractUpxCvx() external {
        address oldContract = address(pirexCvx.upxCvx());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.UpxCvx, newContract);

        address updatedContract = address(pirexCvx.upxCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting SpxCvx
     */
    function testSetContractSpxCvx() external {
        address oldContract = address(pirexCvx.spxCvx());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.SpxCvx, newContract);

        address updatedContract = address(pirexCvx.spxCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting RpxCvx
     */
    function testSetContractRpxCvx() external {
        address oldContract = address(pirexCvx.rpxCvx());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.RpxCvx, newContract);

        address updatedContract = address(pirexCvx.rpxCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting VpxCvx
     */
    function testSetContractVpxCvx() external {
        address oldContract = address(pirexCvx.vpxCvx());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.VpxCvx, newContract);

        address updatedContract = address(pirexCvx.vpxCvx());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);
    }

    /**
        @notice Test setting UnionPirexVault
     */
    function testSetContractUnionPirexVault() external {
        address oldContract = address(pirexCvx.unionPirex());
        address newContract = address(this);

        _setContract(PirexCvx.Contract.UnionPirexVault, newContract);

        address updatedContract = address(pirexCvx.unionPirex());

        assertFalse(oldContract == newContract);
        assertEq(updatedContract, newContract);

        // Check the allowances
        assertEq(pxCvx.allowance(address(pirexCvx), oldContract), 0);
        assertEq(
            pxCvx.allowance(address(pirexCvx), newContract),
            type(uint256).max
        );
    }

    /*//////////////////////////////////////////////////////////////
                        setFee TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reversion if not owner
     */
    function testCannotSetFeeNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.setFee(PirexCvx.Fees.Reward, 1);
    }

    /**
        @notice Test tx reversion if fee amount exceeds max
     */
    function testCannotSetFeeExceedsMax() external {
        PirexCvx.Fees[3] memory feeTypes;
        feeTypes[0] = PirexCvx.Fees.Reward;
        feeTypes[1] = PirexCvx.Fees.RedemptionMax;
        feeTypes[2] = PirexCvx.Fees.RedemptionMin;

        for (uint256 i; i < feeTypes.length; ++i) {
            vm.expectRevert(PirexCvx.InvalidFee.selector);

            pirexCvx.setFee(feeTypes[i], FEE_MAX + 1);
        }
    }

    /**
        @notice Test tx reversion if redemption max fee is less than min
     */
    function testCannotSetFeeRedemptionMaxLessThanMin() external {
        (, , uint32 redemptionMin, ) = pirexCvx.getFees();

        vm.expectRevert(PirexCvx.InvalidFee.selector);

        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMin - 1);
    }

    /**
        @notice Test tx reversion if redemption min fee is greater than max
     */
    function testCannotSetFeeRedemptionMinLessThanMax() external {
        (, uint32 redemptionMax, , ) = pirexCvx.getFees();

        vm.expectRevert(PirexCvx.InvalidFee.selector);

        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMax + 1);
    }

    /**
        @notice Test setting fees for each type
     */
    function testSetFee(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    ) external {
        vm.assume(
            reward < FEE_MAX &&
                redemptionMax < FEE_MAX &&
                redemptionMin < FEE_MAX
        );
        vm.assume(redemptionMax > redemptionMin);

        _resetFees();

        pirexCvx.setFee(PirexCvx.Fees.Reward, reward);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, redemptionMax);
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, redemptionMin);
    }

    /*//////////////////////////////////////////////////////////////
                        addDeveloper TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reverts if not owner
     */
    function testCannotAddDeveloperNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.addDeveloper(address(this));
    }

    /**
        @notice Test tx reverts if developer arg is zero address
     */
    function testCannotAddDeveloperZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.addDeveloper(address(0));
    }

    /**
        @notice Test add developer
     */
    function testAddDeveloper() external {
        address developer = PRIMARY_ACCOUNT;

        assertEq(pirexCvx.developers(developer), false);

        vm.expectEmit(false, false, false, true);

        emit AddDeveloper(developer);

        pirexCvx.addDeveloper(developer);

        assertEq(pirexCvx.developers(developer), true);
    }

    /*//////////////////////////////////////////////////////////////
                        removeDeveloper TESTS
    //////////////////////////////////////////////////////////////*/

    /**
        @notice Test tx reverts if not owner
     */
    function testCannotRemoveDeveloperNotOwner() external {
        vm.expectRevert("Ownable: caller is not the owner");
        vm.prank(secondaryAccounts[0]);

        pirexCvx.removeDeveloper(address(this));
    }

    /**
        @notice Test tx reverts if developer arg is zero address
     */
    function testCannotRemoveDeveloperZeroAddress() external {
        vm.expectRevert(PirexCvxConvex.ZeroAddress.selector);

        pirexCvx.removeDeveloper(address(0));
    }

    /**
        @notice Test remove developer
     */
    function testRemoveDeveloper() external {
        address developer = PRIMARY_ACCOUNT;

        pirexCvx.addDeveloper(developer);

        assertEq(pirexCvx.developers(developer), true);

        vm.expectEmit(false, false, false, true);

        emit RemoveDeveloper(developer);

        pirexCvx.removeDeveloper(developer);

        assertEq(pirexCvx.developers(developer), false);
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
