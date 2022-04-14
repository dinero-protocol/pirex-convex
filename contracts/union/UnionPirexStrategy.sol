// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PirexCvx} from "../PirexCvx.sol";
import {UnionPirexVault} from "./UnionPirexVault.sol";
import {UnionPirexStaking} from "./UnionPirexStaking.sol";

contract UnionPirexStrategy is UnionPirexStaking {
    using SafeERC20 for IERC20;

    PirexCvx public immutable pirexCvx;

    error ZeroAddress();

    constructor(address _pxCVX, address _distributor)
        UnionPirexStaking(_pxCVX, _pxCVX, _distributor)
    {
        if (_pxCVX == address(0)) revert ZeroAddress();
        pirexCvx = PirexCvx(_pxCVX);
    }

    /**
        @notice Redeem pxCVX rewards and transfer them to the distributor
        @param  epoch          uint256    Rewards epoch
        @param  rewardIndexes  uint256[]  Reward indexes
     */
    function redeemRewards(uint256 epoch, uint256[] calldata rewardIndexes)
        external
    {
        pirexCvx.redeemSnapshotRewards(epoch, rewardIndexes, distributor);
    }
}
