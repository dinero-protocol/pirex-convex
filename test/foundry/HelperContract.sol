// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {ERC1155TokenReceiver} from "@rari-capital/solmate/src/tokens/ERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/security/Pausable.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {PirexFees} from "contracts/PirexFees.sol";
import {ERC1155PresetMinterSupply} from "contracts/tokens/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/tokens/ERC1155Solmate.sol";
import {UnionPirexVault} from "contracts/vault/UnionPirexVault.sol";
import {UnionPirexStrategyMock} from "contracts/mocks/UnionPirexStrategyMock.sol";
import {MultiMerkleStash} from "contracts/mocks/MultiMerkleStash.sol";
import {CvxLockerV2} from "contracts/mocks/CvxLocker.sol";

interface IConvexToken is IERC20 {
    function mint(address _to, uint256 _amount) external;

    function totalSupply() external view override returns (uint256);
}

abstract contract HelperContract is
    Test,
    Pausable,
    ERC1155TokenReceiver,
    ERC20("Test", "TEST", 18)
{
    IConvexToken public constant CVX =
        IConvexToken(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    CvxLockerV2 public constant CVX_LOCKER =
        CvxLockerV2(0x72a19342e8F1838460eBFCCEf09F6585e32db86E);

    address public constant CVX_DELEGATE_REGISTRY =
        0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    address public constant VOTIUM_MULTI_MERKLE_STASH =
        0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A;
    address public constant VOTIUM_OWNER =
        0x9d37A22cEc2f6b3635c61C253D192E68e85b1790;
    address public constant PRIMARY_ACCOUNT =
        0x5409ED021D9299bf6814279A6A1411A7e866A631;
    address public constant TREASURY =
        0x086C98855dF3C78C6b481b6e1D47BeF42E9aC36B;
    uint256 public constant EPOCH_DURATION = 1209600;

    PirexCvxMock public immutable pirexCvx;
    PxCvx public immutable pxCvx;
    ERC1155Solmate public immutable spCvx;
    ERC1155Solmate public immutable upCvx;
    ERC1155PresetMinterSupply public immutable vpCvx;
    ERC1155PresetMinterSupply public immutable rpCvx;
    UnionPirexVault public immutable unionPirex;
    UnionPirexStrategyMock public immutable unionPirexStrategy;
    PirexFees public immutable pirexFees;

    address[3] public secondaryAccounts = [
        0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb,
        0xE36Ea790bc9d7AB70C55260C66D52b1eca985f84,
        0xE834EC434DABA538cd1b9Fe1582052B880BD7e63
    ];

    constructor() {
        pxCvx = new PxCvx();
        pirexFees = new PirexFees(TREASURY, msg.sender);
        spCvx = new ERC1155Solmate();
        upCvx = new ERC1155Solmate();
        vpCvx = new ERC1155PresetMinterSupply("");
        rpCvx = new ERC1155PresetMinterSupply("");
        pirexCvx = new PirexCvxMock(
            address(CVX),
            address(CVX_LOCKER),
            CVX_DELEGATE_REGISTRY,
            address(pxCvx),
            address(upCvx),
            address(spCvx),
            address(vpCvx),
            address(rpCvx),
            address(pirexFees),
            VOTIUM_MULTI_MERKLE_STASH
        );
        unionPirex = new UnionPirexVault(address(pxCvx));
        unionPirexStrategy = new UnionPirexStrategyMock(
            address(pirexCvx),
            address(pxCvx),
            address(this),
            address(unionPirex)
        );

        // Configure contracts
        pirexCvx.setFee(PirexCvx.Fees.Reward, uint32(40000));
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMax, uint32(50000));
        pirexCvx.setFee(PirexCvx.Fees.RedemptionMin, uint32(10000));
        pirexCvx.setContract(
            PirexCvx.Contract.UnionPirexVault,
            address(unionPirex)
        );
        pirexCvx.setPauseState(false);
        pxCvx.setOperator(address(pirexCvx));
        spCvx.grantMinterRole(address(pirexCvx));
        pirexFees.grantFeeDistributorRole(address(pirexCvx));

        bytes32 minterRole = keccak256("MINTER_ROLE");

        vpCvx.grantRole(minterRole, address(pirexCvx));
        rpCvx.grantRole(minterRole, address(pirexCvx));
        upCvx.grantRole(minterRole, address(pirexCvx));
        unionPirex.setPlatform(address(this));
        unionPirex.setStrategy(address(unionPirexStrategy));

        // Set maxSupply to the largest possible value
        vm.store(address(CVX), bytes32(uint256(7)), bytes32(type(uint256).max));

        // Set reductionPerCliff to maxSupply to ensure mint amount is reduced by zero
        vm.store(
            address(CVX),
            bytes32(uint256(9)),
            vm.load(address(CVX), bytes32(uint256(7)))
        );
    }

    /**
        @notice Mint CVX for an address
        @param  to      address  CVX receipient
        @param  amount  uint256  CVX amount to mint
     */
    function _mintCvx(address to, uint256 amount) internal {
        // Call mint as the operator
        vm.prank(0xF403C135812408BFbE8713b5A23a04b3D48AAE31);

        CVX.mint(to, amount);
    }

    /**
        @notice Mint and deposit CVX into PirexCvx
        @param  assets          uint256  Amount of CVX to mint and deposit
        @param  receiver        address  Recipient of pxCVX or uCVX
        @param  shouldCompound  bool     Whether to compound with UnionPirexVault
        @param  lock            bool     Whether to lock deposited CVX
     */
    function _mintAndDepositCVX(
        uint256 assets,
        address receiver,
        bool shouldCompound,
        bool lock
    ) internal {
        _mintCvx(receiver, assets);

        vm.startPrank(receiver);

        CVX.approve(address(pirexCvx), CVX.balanceOf(receiver));
        pirexCvx.deposit(assets, receiver, shouldCompound);

        if (lock) {
            pirexCvx.lock();
        }

        vm.stopPrank();
    }

    /**
        @notice Set merkle root
        @param  token       address  Reward token
        @param  amount      uint256  Reward amount
        @param  merkleRoot  bytes32  Reward claim root
     */
    function _loadRewards(
        address token,
        uint256 amount,
        bytes32 merkleRoot
    ) internal {
        // Transfer rewards to Votium
        IERC20(token).transfer(VOTIUM_MULTI_MERKLE_STASH, amount);

        // Set reward merkle root
        vm.prank(VOTIUM_OWNER);

        MultiMerkleStash(VOTIUM_MULTI_MERKLE_STASH).updateMerkleRoot(
            token,
            merkleRoot
        );
    }

    /**
        @notice Claim a single reward for Pirex token holders
        @param  token     address   Reward token
        @param  amount    bytes32   Reward amount
     */
    function _claimSingleReward(address token, uint256 amount) internal {
        // Claim rewards for snapshotted pxCVX holders
        PirexCvx.VotiumReward memory votiumReward;
        votiumReward.token = token;
        votiumReward.index = 0;
        votiumReward.amount = amount;
        votiumReward.merkleProof = new bytes32[](0);
        PirexCvx.VotiumReward[]
            memory votiumRewards = new PirexCvx.VotiumReward[](1);
        votiumRewards[0] = votiumReward;

        pirexCvx.claimVotiumRewards(votiumRewards);
    }

    /**
        @notice Mint reward assets, set merkle root, and claim rewards for Pirex token holders
        @param  assets  uint256  Total reward assets to mint
     */
    function _distributeEpochRewards(uint256 assets) internal {
        // Mint TEST tokens
        _mint(address(this), assets);

        // Transfer to Votium and update metadata
        _loadRewards(
            address(this),
            assets,
            keccak256(abi.encodePacked(uint256(0), address(pirexCvx), assets))
        );

        // Claim reward for PirexCvx, resulting in reward data updating for token holders
        _claimSingleReward(address(this), assets);
    }

    /**
        @notice Validate future notes balances of the specified settings
        @param  fVal     uint8    Number representation of the futures enum
        @param  rounds   uint256  Number of rounds
        @param  account  uint256  Account
        @param  amount   uint256  Amount
     */
    function _validateFutureNotesBalances(
        uint8 fVal,
        uint256 rounds,
        address account,
        uint256 amount
    ) internal {
        uint256 startingEpoch = pirexCvx.getCurrentEpoch() + EPOCH_DURATION;
        ERC1155PresetMinterSupply fToken = (
            PirexCvx.Futures(fVal) == PirexCvx.Futures.Reward ? rpCvx : vpCvx
        );

        for (uint256 i; i < rounds; ++i) {
            assertEq(
                fToken.balanceOf(account, startingEpoch + i * EPOCH_DURATION),
                amount
            );
        }
    }

    /**
        @notice Set all fees to zero
     */
    function _resetFees() internal {
        vm.record();

        (
            uint32 rewardFee,
            uint32 redemptionMax,
            uint32 redemptionMin
        ) = pirexCvx.getFees();

        // Retrieve accessed storage slots and use to reset data
        (bytes32[] memory reads, bytes32[] memory writes) = vm.accesses(
            address(pirexCvx)
        );

        // Set fees to 0
        vm.store(address(pirexCvx), reads[0], bytes32(uint256(0)));
        vm.store(address(pirexCvx), reads[1], bytes32(uint256(0)));
        vm.store(address(pirexCvx), reads[2], bytes32(uint256(0)));
    }

    /**
        @notice Handle the receipt of a single ERC1155 token type.
        @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeTransferFrom` after the balance has been updated.        
        This function MUST return `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))` (i.e. 0xf23a6e61) if it accepts the transfer.
        This function MUST revert if it rejects the transfer.
        Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
        @param  _operator  address  The address which initiated the transfer (i.e. msg.sender)
        @param  _from      address  The address which previously owned the token
        @param  _id        uint256  The ID of the token being transferred
        @param  _value     uint256  The amount of tokens being transferred
        @param  _data      bytes    Additional data with no specified format
        @return bytes4              `bytes4(keccak256("onERC1155Received(address,address,uint256,uint256,bytes)"))`
    */
    function onERC1155Received(
        address _operator,
        address _from,
        uint256 _id,
        uint256 _value,
        bytes calldata _data
    ) external pure override returns (bytes4) {
        return ERC1155TokenReceiver.onERC1155Received.selector;
    }

    /**
        @notice Handle the receipt of multiple ERC1155 token types.
        @dev An ERC1155-compliant smart contract MUST call this function on the token recipient contract, at the end of a `safeBatchTransferFrom` after the balances have been updated.        
        This function MUST return `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))` (i.e. 0xbc197c81) if it accepts the transfer(s).
        This function MUST revert if it rejects the transfer(s).
        Return of any other value than the prescribed keccak256 generated value MUST result in the transaction being reverted by the caller.
        @param  _operator  address    The address which initiated the batch transfer (i.e. msg.sender)
        @param  _from      address    The address which previously owned the token
        @param  _ids       uint256[]  An array containing ids of each token being transferred (order and length must match _values array)
        @param  _values    uint256[]  An array containing amounts of each token being transferred (order and length must match _ids array)
        @param  _data      bytes      Additional data with no specified format
        @return bytes4                `bytes4(keccak256("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"))`
    */
    function onERC1155BatchReceived(
        address _operator,
        address _from,
        uint256[] calldata _ids,
        uint256[] calldata _values,
        bytes calldata _data
    ) external pure override returns (bytes4) {
        return ERC1155TokenReceiver.onERC1155BatchReceived.selector;
    }
}
