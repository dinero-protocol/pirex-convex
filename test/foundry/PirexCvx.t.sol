// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvx} from "contracts/PirexCvx.sol";
import {PxCvx} from "contracts/PxCvx.sol";
import {ERC1155PresetMinterSupply} from "contracts/ERC1155PresetMinterSupply.sol";
import {ERC1155Solmate} from "contracts/ERC1155Solmate.sol";
import {HelperContract} from "./HelperContract.sol";

interface ICvxLocker {
    function lockedBalanceOf(address _user)
        external
        view
        returns (uint256 amount);
}

contract PirexCvxTest is Test, ERC20("Test", "TEST", 18), HelperContract {
    ERC20 private CVX;
    PxCvx private immutable pxCvx;
    ERC1155Solmate private immutable spCvx;
    ERC1155PresetMinterSupply private immutable rpCvx;
    PirexCvx private immutable pirexCvx;
    address private constant RECEIVER =
        0x5409ED021D9299bf6814279A6A1411A7e866A631;
    address[3] private testers = [
        0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb,
        0xE36Ea790bc9d7AB70C55260C66D52b1eca985f84,
        0xE834EC434DABA538cd1b9Fe1582052B880BD7e63
    ];

    constructor() {
        CVX = ERC20(cvx);
        (pxCvx, spCvx, , rpCvx, pirexCvx) = _deployPirex();

        vm.prank(RECEIVER);
        CVX.approve(address(pirexCvx), type(uint256).max);
    }

    function setUp() external {
        uint256 assets = 20000e18;
        uint256 rewards = 100e18;

        _mintCvx(RECEIVER, assets);
        _mint(address(this), rewards);

        // Deposit and stake pxCVX
        vm.prank(RECEIVER);
        pirexCvx.deposit(assets, RECEIVER, false);

        vm.prank(RECEIVER);
        pirexCvx.stake(1, PirexCvx.Futures.Reward, assets / 2, RECEIVER);

        // Set timestamp to next epoch in order to snapshot and calculate rewards
        vm.warp(block.timestamp + 1209600);

        // TODO: Generate root in contract (using JS libraries to do so for now)
        _loadRewards(
            address(this),
            rewards,
            0xe268e5750b51088466619d7b2df73c42a850ced690c2485faad4eac64e6102ff
        );

        _claimSingleReward(pirexCvx, address(this), rewards);
    }

    function _bytes32ToAddress(bytes32 addr) internal pure returns (address) {
        return address(uint160(bytes20(addr)));
    }

    function _transferRpCvx(
        address caller,
        address receiver,
        uint256 epoch,
        uint256 amount
    ) internal returns (uint256 callerBalance, uint256 receiverBalance) {
        vm.prank(caller);
        rpCvx.safeTransferFrom(caller, receiver, epoch, amount, "");

        callerBalance = rpCvx.balanceOf(caller, epoch);
        receiverBalance = rpCvx.balanceOf(receiver, epoch);
    }

    function testRedeemFuturesRewards() external {
        uint256 currentEpoch = pxCvx.getCurrentEpoch();
        (, bytes32[] memory rewards, , uint256[] memory futuresRewards) = pxCvx
            .getEpoch(currentEpoch);
        uint256 rpCvxBalance = rpCvx.balanceOf(RECEIVER, currentEpoch);
        uint256 rpCvxSupply = rpCvx.totalSupply(currentEpoch);
        ERC20 reward = ERC20(_bytes32ToAddress(rewards[0]));
        uint256[] memory distribution = new uint256[](testers.length);

        distribution[0] = (rpCvxBalance * (30 * 256)) / type(uint16).max;
        distribution[1] = (rpCvxBalance * (60 * 256)) / type(uint16).max;
        distribution[2] = rpCvxBalance - (distribution[0] + distribution[1]);

        uint256 totalRedeemedRewards;

        for (uint256 i; i < testers.length; ++i) {
            address tester = testers[i];

            _transferRpCvx(RECEIVER, tester, currentEpoch, distribution[i]);

            vm.prank(tester);
            rpCvx.setApprovalForAll(address(pirexCvx), true);

            vm.prank(tester);
            pirexCvx.redeemFuturesRewards(currentEpoch, tester);
            totalRedeemedRewards += reward.balanceOf(tester);
        }

        assertTrue(totalRedeemedRewards <= futuresRewards[0]);
    }
}
