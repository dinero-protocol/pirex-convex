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

contract PirexCvxTest is Test, HelperContract {
    ERC20 private CVX;
    PxCvx private immutable pxCvx;
    ERC1155Solmate private immutable spCvx;
    ERC1155PresetMinterSupply private immutable vpCvx;
    ERC1155PresetMinterSupply private immutable rpCvx;
    PirexCvx private immutable pirexCvx;
    address private constant RECEIVER =
        0x5409ED021D9299bf6814279A6A1411A7e866A631;

    constructor() {
        CVX = ERC20(cvx);
        (pxCvx, spCvx, vpCvx, rpCvx, pirexCvx) = _deployPirex();

        vm.prank(RECEIVER);
        CVX.approve(address(pirexCvx), type(uint256).max);
    }

    function setUp() external {
        _mintCvx(address(this), 20000e18);

        uint256 assets = 10000e18;
        uint256 rewards = 100e18;

        CVX.transfer(RECEIVER, assets);

        // Deposit and stake pxCVX
        vm.prank(RECEIVER);
        pirexCvx.deposit(assets, RECEIVER, false);

        vm.prank(RECEIVER);
        pirexCvx.stake(1, PirexCvx.Futures.Reward, 5000e18, RECEIVER);

        // Set timestamp to next epoch in order to snapshot and calculate rewards
        vm.warp(block.timestamp + 1209600);

        // TODO: Generate root in contract (using JS libraries to do so for now)
        _loadRewards(
            cvx,
            rewards,
            0xe268e5750b51088466619d7b2df73c42a850ced690c2485faad4eac64e6102ff
        );

        _claimSingleReward(pirexCvx, cvx, rewards);
    }
}
