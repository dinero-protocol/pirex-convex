// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {PirexFees} from "contracts/PirexFees.sol";
import {ERC1155PresetMinterSupply} from "contracts/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/ERC1155Solmate.sol";
import {UnionPirexVault} from "contracts/UnionPirexVault.sol";

interface IConvexToken {
    function mint(address _to, uint256 _amount) external;

    function totalSupply() external returns (uint256);
}

abstract contract HelperContract is Test {
    address public constant cvx = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address public constant cvxLocker =
        0x72a19342e8F1838460eBFCCEf09F6585e32db86E;
    address public constant cvxDelegateRegistry =
        0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    address public constant votiumMultiMerkleStash =
        0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A;

    function _deployPirex()
        internal
        returns (
            PxCvx pxCvx,
            ERC1155Solmate spCvx,
            ERC1155PresetMinterSupply vpCvx,
            ERC1155PresetMinterSupply rpCvx,
            PirexCvxMock pirexCvx
        )
    {
        pxCvx = new PxCvx();

        ERC1155Solmate upCvx = new ERC1155Solmate();
        PirexFees pirexFees = new PirexFees(msg.sender, msg.sender);
        UnionPirexVault unionPirex = new UnionPirexVault(
            ERC20(address(pxCvx)),
            "Pirex CVX",
            "pxCVX"
        );

        spCvx = new ERC1155Solmate();
        vpCvx = new ERC1155PresetMinterSupply("");
        rpCvx = new ERC1155PresetMinterSupply("");
        pirexCvx = new PirexCvxMock(
            cvx,
            cvxLocker,
            cvxDelegateRegistry,
            address(pxCvx),
            address(upCvx),
            address(spCvx),
            address(vpCvx),
            address(rpCvx),
            address(pirexFees),
            votiumMultiMerkleStash
        );

        // Configure contracts
        pirexCvx.setInitialFees(uint32(40000), uint32(50000), uint32(10000));
        pirexCvx.setContract(
            PirexCvx.Contract.UnionPirexVault,
            address(unionPirex)
        );
        pirexCvx.setPauseState(false);
        pxCvx.setOperator(address(pirexCvx));

        // Update reductionPerCliff to ensure 100% amount is minted
        vm.store(
            cvx,
            bytes32(uint256(9)),
            bytes32(IConvexToken(cvx).totalSupply() + 1)
        );
    }

    function _mintCvx(address to, uint256 amount) internal {
        // Call mint as the operator
        vm.prank(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);

        IConvexToken(cvx).mint(to, amount);
    }
}
