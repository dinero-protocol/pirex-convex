// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
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

abstract contract HelperContract is Test, Pausable, ERC20("Test", "TEST", 18) {
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
        pirexFees = new PirexFees(msg.sender, msg.sender);
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
        pirexCvx.setInitialFees(uint32(40000), uint32(50000), uint32(10000));
        pirexCvx.setContract(
            PirexCvx.Contract.UnionPirexVault,
            address(unionPirex)
        );
        pirexCvx.setPauseState(false);
        pxCvx.setOperator(address(pirexCvx));
        spCvx.grantMinterRole(address(pirexCvx));
        pirexFees.grantFeeDistributorRole(address(pirexCvx));

        bytes32 minterRole = keccak256("MINTER_ROLE");

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
}
