// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.12;

import "forge-std/Test.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {PirexCvxMock} from "contracts/mocks/PirexCvxMock.sol";
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
    PirexCvxMock private immutable pirexCvx;
    address private constant PRIMARY_ACCOUNT =
        0x5409ED021D9299bf6814279A6A1411A7e866A631;
    address[3] private testers = [
        0x6Ecbe1DB9EF729CBe972C83Fb886247691Fb6beb,
        0xE36Ea790bc9d7AB70C55260C66D52b1eca985f84,
        0xE834EC434DABA538cd1b9Fe1582052B880BD7e63
    ];
    uint256 private constant EPOCH_DURATION = 1209600;

    constructor() {
        CVX = ERC20(cvx);
        (pxCvx, spCvx, , rpCvx, pirexCvx) = _deployPirex();

        vm.prank(PRIMARY_ACCOUNT);
        CVX.approve(address(pirexCvx), type(uint256).max);
    }

    function _mintAndDepositCVX(uint256 assets, bool shouldCompound) internal {
        _mintCvx(PRIMARY_ACCOUNT, assets);
        vm.prank(PRIMARY_ACCOUNT);
        pirexCvx.deposit(assets, PRIMARY_ACCOUNT, shouldCompound);
        pirexCvx.lock();
    }

    function _stakePxCvx(uint256 rounds, uint256 assets) internal {
        vm.prank(PRIMARY_ACCOUNT);
        pirexCvx.stake(
            rounds,
            PirexCvx.Futures.Reward,
            assets,
            PRIMARY_ACCOUNT
        );
    }

    function _transferRpCvx(
        address receiver,
        uint256 epoch,
        uint256 amount
    ) internal {
        vm.prank(PRIMARY_ACCOUNT);
        rpCvx.safeTransferFrom(PRIMARY_ACCOUNT, receiver, epoch, amount, "");
    }

    function _distributeNotesRedeemRewards(uint256 assets, bytes4 selector)
        internal
        returns (
            uint256 totalRedeemedRewards,
            uint256 totalFuturesRewards,
            uint256 totalAttemptedRedemptions
        )
    {
        uint256 tLen = testers.length;
        uint256 epoch = pxCvx.getCurrentEpoch();
        (, , , uint256[] memory allFuturesRewards) = pxCvx.getEpoch(epoch);
        totalFuturesRewards = allFuturesRewards[0];

        for (uint256 i; i < tLen; ++i) {
            (, , , uint256[] memory currentFuturesRewards) = pxCvx.getEpoch(
                epoch
            );
            uint256 transferAmount = (tLen - 1) != i
                ? assets / (tLen - i)
                : rpCvx.balanceOf(PRIMARY_ACCOUNT, epoch);
            address tester = testers[i];

            // Tally up the attempted redemptions amounts using the same variables as the method
            totalAttemptedRedemptions +=
                (currentFuturesRewards[0] * transferAmount) /
                rpCvx.totalSupply(epoch);

            // Transfer rpCVX so that tester can redeem futures rewards
            _transferRpCvx(tester, epoch, transferAmount);

            // Impersonate tester and redeem futures rewards
            vm.startPrank(tester);
            rpCvx.setApprovalForAll(address(pirexCvx), true);

            // Call either the patched or bugged redeemFuturesReward method
            // `success` inconsistently returns false for bugged method so is not checked
            address(pirexCvx).call(
                abi.encodeWithSelector(selector, epoch, tester)
            );
            vm.stopPrank();

            // Total up redeemed reward amount to confirm whether redemption amount is correct
            totalRedeemedRewards += balanceOf[tester];

            // Set tester balance to zero so we can easily test future redeemed totals
            balanceOf[tester] = 0;
        }
    }

    function testRedeemFuturesRewards(
        uint8 rounds,
        uint256 assets,
        uint256 stakePercent,
        bool testBugged
    ) external {
        vm.assume(rounds != 0);
        vm.assume(rounds < 10);
        vm.assume(assets != 0);
        vm.assume(assets < 10000e18);
        vm.assume(assets > 1e18);
        vm.assume(stakePercent != 0);
        vm.assume(stakePercent < 255);

        uint256 stakeAmount = (assets * stakePercent) / 255;

        _mintAndDepositCVX(assets, false);
        _stakePxCvx(rounds, stakeAmount);

        // Forward 1 epoch, since rpxCVX has claim to rewards in subsequent epochs
        vm.warp(block.timestamp + EPOCH_DURATION);

        for (uint256 i; i < rounds; ++i) {
            // Mint TEST tokens
            _mint(address(this), assets);

            // Transfer to Votium and update metadata
            _loadRewards(
                address(this),
                assets,
                keccak256(
                    abi.encodePacked(uint256(0), address(pirexCvx), assets)
                )
            );

            // Claim reward for PirexCvx, resulting in reward data updating for token holders
            _claimSingleReward(pirexCvx, address(this), assets);

            // Distribute rpCVX to testers and redeem their futures rewards
            (
                uint256 totalRedeemedRewards,
                uint256 totalFuturesRewards,
                uint256 totalAttemptedRedemptions
            ) = _distributeNotesRedeemRewards(
                    stakeAmount,
                    testBugged
                        ? pirexCvx.redeemFuturesRewardsBugged.selector
                        : pirexCvx.redeemFuturesRewards.selector
                );

            if (testBugged) {
                assertGt(totalAttemptedRedemptions, totalFuturesRewards);
            } else {
                assertEq(totalRedeemedRewards, totalFuturesRewards);
                assertEq(totalAttemptedRedemptions, totalFuturesRewards);
            }

            // Forward to the next block and repeat
            vm.warp(block.timestamp + EPOCH_DURATION);
        }
    }
}
