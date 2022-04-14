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

    /// @notice Claim rewards and restakes them
    /// @dev Can be called by the vault only
    /// @param _caller - the address calling the harvest on the vault
    /// @return harvested - the amount harvested
    function harvest(address _caller) external returns (uint256 harvested) {
        require(address(vault) == msg.sender, "Vault calls only");

        // claim rewards
        getReward();

        uint256 _pCvxBalance = stakingToken.balanceOf(address(this));

        uint256 _stakingAmount = _pCvxBalance;

        if (_pCvxBalance > 0) {
            // if this is the last call, no fees
            if (vault.totalSupply() != 0) {
                // Deduce and pay out incentive to caller (not needed for final exit)
                if (vault.callIncentive() > 0) {
                    uint256 incentiveAmount = (_pCvxBalance *
                        vault.callIncentive()) / FEE_DENOMINATOR;
                    stakingToken.safeTransfer(_caller, incentiveAmount);
                    _stakingAmount -= incentiveAmount;
                }
                // Deduce and pay platform fee
                if (vault.platformFee() > 0) {
                    uint256 feeAmount = (_pCvxBalance * vault.platformFee()) /
                        FEE_DENOMINATOR;
                    stakingToken.safeTransfer(vault.platform(), feeAmount);
                    _stakingAmount -= feeAmount;
                }
            }
            // Restake
            this.stake(_stakingAmount);
        }
        return _stakingAmount;
    }
}
