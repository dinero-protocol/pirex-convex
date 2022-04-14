// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./UnionPirexVault.sol";
import "./UnionPirexStaking.sol";

contract UnionPirexStrategy is Ownable {
    using SafeERC20 for IERC20;

    UnionPirexVault public immutable vault;
    UnionPirexStaking public stakingRewards;
    IERC20 public immutable pCVX;

    uint256 public constant FEE_DENOMINATOR = 10000;

    constructor(
        address _vault,
        address _rewards,
        address _pcvx
    ) {
        vault = UnionPirexVault(_vault);
        stakingRewards = UnionPirexStaking(_rewards);
        pCVX = IERC20(_pcvx);
    }

    /// @notice Set approvals for the contracts used when swapping & staking
    function setApprovals() external {
        pCVX.safeApprove(address(stakingRewards), type(uint256).max);
    }

    /// @notice Query the amount currently staked
    /// @return total - the total amount of tokens staked
    function totalUnderlying() public view returns (uint256 total) {
        return stakingRewards.balanceOf(address(this));
    }

    /// @notice Deposits all underlying tokens in the staking contract
    function stake(uint256 _amount) external onlyVault {
        pCVX.safeTransferFrom(msg.sender, address(this), _amount);
        stakingRewards.stake(_amount);
    }

    /// @notice Withdraw a certain amount from the staking contract
    /// @param _amount - the amount to withdraw
    /// @dev Can only be called by the vault
    function withdraw(uint256 _amount) external onlyVault {
        stakingRewards.withdraw(_amount);
        pCVX.safeTransfer(address(vault), _amount);
    }

    /// @notice Claim rewards and restakes them
    /// @dev Can be called by the vault only
    /// @param _caller - the address calling the harvest on the vault
    /// @return harvested - the amount harvested
    function harvest(address _caller)
        external
        onlyVault
        returns (uint256 harvested)
    {
        // claim rewards
        stakingRewards.getReward();

        uint256 _pCvxBalance = pCVX.balanceOf(address(this));

        uint256 _stakingAmount = _pCvxBalance;

        if (_pCvxBalance > 0) {
            // if this is the last call, no fees
            if (vault.totalSupply() != 0) {
                // Deduce and pay out incentive to caller (not needed for final exit)
                if (vault.callIncentive() > 0) {
                    uint256 incentiveAmount = (_pCvxBalance *
                        vault.callIncentive()) / FEE_DENOMINATOR;
                    pCVX.safeTransfer(_caller, incentiveAmount);
                    _stakingAmount -= incentiveAmount;
                }
                // Deduce and pay platform fee
                if (vault.platformFee() > 0) {
                    uint256 feeAmount = (_pCvxBalance * vault.platformFee()) /
                        FEE_DENOMINATOR;
                    pCVX.safeTransfer(vault.platform(), feeAmount);
                    _stakingAmount -= feeAmount;
                }
            }
            // Restake
            stakingRewards.stake(_stakingAmount);
        }
        return _stakingAmount;
    }

    modifier onlyVault() {
        require(address(vault) == msg.sender, "Vault calls only");
        _;
    }
}
