// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
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
        @param  _upCvx                   address  UpCvx address
        @param  _spCvx                   address  SpCvx address
        @param  _vpCvx                   address  VpCvx address
        @param  _rpCvx                   address  RpCvx address
        @param  _pirexFees               address  PirexFees address
        @param  _votiumMultiMerkleStash  address  VotiumMultiMerkleStash address
     */
    constructor(
        address _CVX,
        address _cvxLocker,
        address _cvxDelegateRegistry,
        address _pxCvx,
        address _upCvx,
        address _spCvx,
        address _vpCvx,
        address _rpCvx,
        address _pirexFees,
        address _votiumMultiMerkleStash
    )
        PirexCvx(
            _CVX,
            _cvxLocker,
            _cvxDelegateRegistry,
            _pxCvx,
            _upCvx,
            _spCvx,
            _vpCvx,
            _rpCvx,
            _pirexFees,
            _votiumMultiMerkleStash
        )
    {}

    /** 
        @notice Set the initial fees
        @param  reward         uint32  Reward fee
        @param  redemptionMax  uint32  Redemption max fee
        @param  redemptionMin  uint32  Redemption min fee
     */
    function setInitialFees(
        uint32 reward,
        uint32 redemptionMax,
        uint32 redemptionMin
    ) external {
        if (
            fees[Fees.Reward] != 0 ||
            fees[Fees.RedemptionMax] != 0 ||
            fees[Fees.RedemptionMin] != 0
        )
            revert FeesAlreadySet(
                fees[Fees.Reward],
                fees[Fees.RedemptionMax],
                fees[Fees.RedemptionMin]
            );

        fees[Fees.Reward] = reward;
        fees[Fees.RedemptionMax] = redemptionMax;
        fees[Fees.RedemptionMin] = redemptionMin;

        emit SetInitialFees(reward, redemptionMax, redemptionMin);
    }

    /**
        @notice Redeem Futures rewards for rpCVX holders for an epoch
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

        // Check sender rpCVX balance
        uint256 rpCvxBalance = rpCvx.balanceOf(msg.sender, epoch);
        if (rpCvxBalance == 0) revert InsufficientBalance();

        // Store rpCVX total supply before burning
        uint256 rpCvxTotalSupply = rpCvx.totalSupply(epoch);

        // Burn rpCVX tokens
        rpCvx.burn(msg.sender, epoch, rpCvxBalance);

        uint256 rLen = rewards.length;

        // Loop over rewards and transfer the amount entitled to the rpCVX token holder
        for (uint256 i; i < rLen; ++i) {
            // Proportionate to the % of rpCVX owned out of the rpCVX total supply
            ERC20(address(uint160(bytes20(rewards[i])))).safeTransfer(
                receiver,
                (futuresRewards[i] * rpCvxBalance) / rpCvxTotalSupply
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
            uint32
        )
    {
        return (
            fees[Fees.Reward],
            fees[Fees.RedemptionMax],
            fees[Fees.RedemptionMin]
        );
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
        uint256 rpCvxSupply,
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
            rpCvxSupply,
            received
        );
    }
}
