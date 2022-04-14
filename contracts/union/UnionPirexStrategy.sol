// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./UnionPirexVault.sol";
import "./UnionPirexStaking.sol";

contract UnionPirexStrategy is UnionPirexStaking {
    using SafeERC20 for IERC20;

    UnionPirexVault public immutable vault;

    uint256 public constant FEE_DENOMINATOR = 10000;

    error ZeroAddress();

    constructor(
        address _vault,
        address _pxCVX,
        address _distributor
    ) UnionPirexStaking(_pxCVX, _pxCVX, _distributor) {
        vault = UnionPirexVault(_vault);
    }

    /**
        @notice Claim the available rewards (distributed over 14 days) and restake
        @return harvested  uint256  Shares
     */
    function harvest() external returns (uint256 harvested) {
        require(address(vault) == msg.sender, "Vault calls only");

        uint256 balanceBeforeRewards = stakingToken.balanceOf(address(this));

        // Claim rewards
        getReward();

        uint256 rewardsReceived = balanceBeforeRewards -
            stakingToken.balanceOf(address(this));

        if (rewardsReceived != 0) {
            // Deduce and pay platform fee
            uint256 feeAmount = (rewardsReceived * vault.platformFee()) /
                FEE_DENOMINATOR;
            stakingToken.safeTransfer(vault.platform(), feeAmount);
            rewardsReceived -= feeAmount;
            this.stake(rewardsReceived);
        }

        return rewardsReceived;
    }
}
