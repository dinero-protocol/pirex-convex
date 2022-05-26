// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {ICvxLocker} from "contracts/interfaces/ICvxLocker.sol";
import {PirexCvx} from "../PirexCvx.sol";

contract PirexCvxMock is PirexCvx {
    using SafeTransferLib for ERC20;

    event SetInitialFees(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    );

    error FeesAlreadySet(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    );

    /**
        @param  _CVX                     address  CVX address    
        @param  _cvxLocker               address  CvxLocker address
        @param  _cvxDelegateRegistry     address  CvxDelegateRegistry address
        @param  _pxCvx                   address  PxCvx address
        @param  _upxCvx                  address  UpxCvx address
        @param  _spxCvx                  address  SpxCvx address
        @param  _vpxCvx                  address  VpxCvx address
        @param  _rpxCvx                  address  RpxCvx address
        @param  _pirexFees               address  PirexFees address
        @param  _votiumMultiMerkleStash  address  VotiumMultiMerkleStash address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _pxCvx,
        address _upxCvx,
        address _spxCvx,
        address _vpxCvx,
        address _rpxCvx,
        address _pirexFees,
        address _votiumMultiMerkleStash
    )
        PirexCvx(
            _CVX,
            _cvxLocker,
            _cvxDelegateRegistry,
            _pxCvx,
            _upxCvx,
            _spxCvx,
            _vpxCvx,
            _rpxCvx,
            _pirexFees,
            _votiumMultiMerkleStash
        )
    {}

    /**
        @notice Redeem Futures rewards for rpxCVX holders for an epoch
        @param  epoch     uint256  Epoch (ERC1155 token id)
        @param  receiver  address  Receives futures rewards
    */
    function redeemFuturesRewardsBugged(uint256 epoch, address receiver)
        external
        whenNotPaused
        nonReentrant
    {
        if (epoch == 0) revert InvalidEpoch();
        if (epoch > getCurrentEpoch()) revert InvalidEpoch();
        if (receiver == address(0)) revert ZeroAddress();

        // Prevent users from burning their futures notes before rewards are claimed
        (, bytes32[] memory rewards, , uint256[] memory futuresRewards) = pxCvx
            .getEpoch(epoch);

        if (rewards.length == 0) revert NoRewards();

        emit RedeemFuturesRewards(epoch, receiver, rewards);

        // Check sender rpxCVX balance
        uint256 rpxCvxBalance = rpxCvx.balanceOf(msg.sender, epoch);
        if (rpxCvxBalance == 0) revert InsufficientBalance();

        // Store rpxCVX total supply before burning
        uint256 rpxCvxTotalSupply = rpxCvx.totalSupply(epoch);

        // Burn rpxCVX tokens
        rpxCvx.burn(msg.sender, epoch, rpxCvxBalance);

        uint256 rLen = rewards.length;

        // Loop over rewards and transfer the amount entitled to the rpxCVX token holder
        for (uint256 i; i < rLen; ++i) {
            // Proportionate to the % of rpxCVX owned out of the rpxCVX total supply
            ERC20(address(uint160(bytes20(rewards[i])))).safeTransfer(
                receiver,
                (futuresRewards[i] * rpxCvxBalance) / rpxCvxTotalSupply
            );
        }
    }

    function getOutstandingRedemptions() external view returns (uint256) {
        return outstandingRedemptions;
    }

    function getPendingLocks() external view returns (uint256) {
        return pendingLocks;
    }

    function getFees()
        external
        view
        returns (
            uint32,
            uint32,
            uint32,
            uint32
        )
    {
        return (
            fees[Fees.Reward],
            fees[Fees.RedemptionMax],
            fees[Fees.RedemptionMin],
            fees[Fees.Developers]
        );
    }

    /**
        @notice Initiate CVX redemptions
        @param  lockIndexes  uint256[]  Locked balance index
        @param  f            enum       Futures enum
        @param  assets       uint256[]  pxCVX amounts
        @param  receiver     address    Receives upxCVX
     */
    function initiateRedemptionsFaulty(
        uint256[] calldata lockIndexes,
        Futures f,
        uint256[] calldata assets,
        address receiver
    ) external whenNotPaused nonReentrant {
        uint256 lockLen = lockIndexes.length;
        if (lockLen == 0) revert EmptyArray();
        if (lockLen != assets.length) revert MismatchedArrayLengths();

        emit InitiateRedemptions(lockIndexes, f, assets, receiver);

        (, , , ICvxLocker.LockedBalance[] memory lockData) = cvxLocker
            .lockedBalances(address(this));
        uint256 totalAssets;
        uint256 feeAmount;
        uint256 feeMin = fees[Fees.RedemptionMin];
        uint256 feeMax = fees[Fees.RedemptionMax];

        for (uint256 i; i < lockLen; ++i) {
            totalAssets += assets[i];
            feeAmount += _initiateRedemption(
                lockData[lockIndexes[i]],
                f,
                assets[i],
                receiver,
                feeMin,
                feeMax
            );
        }

        // Burn pxCVX - reverts if sender balance is insufficient
        pxCvx.burn(msg.sender, totalAssets - feeAmount);

        // NOTE: Reverts (zero amount check) if redemption fees are zero
        // Allow PirexFees to distribute fees directly from sender
        pxCvx.operatorApprove(msg.sender, address(pirexFees), feeAmount);

        // Distribute fees
        pirexFees.distributeFees(msg.sender, address(pxCvx), feeAmount);
    }

    function getEmergencyExecutor() external view returns (address) {
        return emergencyExecutor;
    }

    function getEmergencyMigration()
        external
        view
        returns (address recipient, address[] memory tokens)
    {
        return (emergencyMigration.recipient, emergencyMigration.tokens);
    }

    function calculateRewards(
        uint32 feePercent,
        uint256 snapshotSupply,
        uint256 rpxCvxSupply,
        uint256 received
    )
        external
        pure
        returns (
            uint256 rewardFee,
            uint256 snapshotRewards,
            uint256 futuresRewards
        )
    {
        (rewardFee, snapshotRewards, futuresRewards) = _calculateRewards(
            feePercent,
            snapshotSupply,
            rpxCvxSupply,
            received
        );
    }

    function unlockBugged() external whenPaused onlyOwner {
        // Bugged version where we always check for `unlockables` before calling `processExpiredLocks`
        _unlock(false);
    }
}
