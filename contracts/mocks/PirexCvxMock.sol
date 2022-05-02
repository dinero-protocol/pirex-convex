// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {PirexCvx} from "../PirexCvx.sol";

contract PirexCvxMock is PirexCvx {
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
}
