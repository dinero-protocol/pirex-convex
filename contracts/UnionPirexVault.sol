// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC4626} from "@rari-capital/solmate/src/mixins/ERC4626.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {FixedPointMathLib} from "@rari-capital/solmate/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {PirexCvx} from "./PirexCvx.sol";
import {UnionPirexStaking} from "./UnionPirexStaking.sol";

contract UnionPirexVault is Ownable, ERC4626 {
    using SafeTransferLib for ERC20;
    using FixedPointMathLib for uint256;

    PirexCvx public pirexCvx;
    UnionPirexStaking public strategy;

    uint8 public constant MAX_CALL_INCENTIVE = 250;
    uint16 public constant MAX_WITHDRAWAL_PENALTY = 500;
    uint16 public constant MAX_PLATFORM_FEE = 2000;
    uint16 public constant FEE_DENOMINATOR = 10000;

    uint8 public callIncentive = 100;
    uint16 public withdrawalPenalty = 300;
    uint16 public platformFee = 500;

    address public platform;

    event Harvest(address indexed _caller, uint256 _value);
    event WithdrawalPenaltyUpdated(uint256 _penalty);
    event CallerIncentiveUpdated(uint256 _incentive);
    event PlatformFeeUpdated(uint256 _fee);
    event PlatformUpdated(address indexed _platform);
    event StrategySet(address indexed _strategy);

    error ZeroAddress();
    error ExceedsMax();

    constructor(address _pirexCvx)
        ERC4626(ERC20(_pirexCvx), "Union Pirex", "uCVX")
    {
        if (_pirexCvx == address(0)) revert ZeroAddress();
        pirexCvx = PirexCvx(_pirexCvx);
    }

    /**
        @notice Set the withdrawal penalty
        @param _penalty  uint16  Withdrawal penalty
     */
    function setWithdrawalPenalty(uint16 _penalty) external onlyOwner {
        if (_penalty > MAX_WITHDRAWAL_PENALTY) revert ExceedsMax();
        withdrawalPenalty = _penalty;
        emit WithdrawalPenaltyUpdated(_penalty);
    }

    /**
        @notice Set the call incentive
        @param _incentive  uint8  Call incentive
     */
    function setCallIncentive(uint8 _incentive) external onlyOwner {
        if (_incentive > MAX_CALL_INCENTIVE) revert ExceedsMax();
        callIncentive = _incentive;
        emit CallerIncentiveUpdated(_incentive);
    }

    /**
        @notice Set the platform fee
        @param _fee  uint16  Platform fee
     */
    function setPlatformFee(uint16 _fee) external onlyOwner {
        if (_fee > MAX_PLATFORM_FEE) revert ExceedsMax();
        platformFee = _fee;
        emit PlatformFeeUpdated(_fee);
    }

    /**
        @notice Set the platform
        @param _platform  address  Platform
     */
    function setPlatform(address _platform) external onlyOwner {
        if (_platform == address(0)) revert ZeroAddress();
        platform = _platform;
        emit PlatformUpdated(_platform);
    }

    /**
        @notice Set the strategy
        @param _strategy  address  Strategy
     */
    function setStrategy(address _strategy) external onlyOwner {
        if (_strategy == address(0)) revert ZeroAddress();

        // Store old strategy to perform maintenance if needed
        address oldStrategy = address(strategy);

        // Set new strategy contract and approve max allowance
        strategy = UnionPirexStaking(_strategy);
        pirexCvx.approve(_strategy, type(uint256).max);

        // Set allowance of previous strategy to 0
        if (oldStrategy != address(0)) {
            pirexCvx.approve(oldStrategy, 0);

            // Migrate previous strategy balance to new strategy
            uint256 balance = pirexCvx.getBalanceOf(oldStrategy);
            if (balance != 0) {
                UnionPirexStaking(oldStrategy).withdraw(balance);
                strategy.stake(balance);
            }
        }

        emit StrategySet(_strategy);
    }

    /**
        @notice Get the pxCVX custodied by the UnionPirex contracts
        @return uint256  Assets
     */
    function totalAssets() public view override returns (uint256) {
        return
            pirexCvx.getBalanceOf(address(this)) +
            pirexCvx.getBalanceOf(address(strategy));
    }

    /**
        @notice Withdraw assets from the staking contract to prepare for transfer to user
        @param  assets  uint256  Assets
        @param  shares  uint256  Shares
     */
    function beforeWithdraw(uint256 assets, uint256 shares) internal override {
        strategy.withdraw(assets);
    }

    /**
        @notice Stake assets so that rewards can be properly distributed
        @param  assets  uint256  Assets
        @param  shares  uint256  Shares
     */
    function afterDeposit(uint256 assets, uint256 shares) internal override {
        strategy.stake(assets);
    }

    /**
        @notice Preview the amount of assets a user would receive from redeeming shares
        @param  shares  uint256  Shares
        @return uint256  Assets
     */
    function previewRedeem(uint256 shares)
        public
        view
        override
        returns (uint256)
    {
        // Calculate assets based on a user's % ownership of vault shares
        uint256 assets = convertToAssets(shares);

        // Calculate a penalty (0 if user is the last to withdraw)
        uint256 penalty = (totalSupply == 0 || totalSupply - shares == 0)
            ? 0
            : (assets * withdrawalPenalty) / FEE_DENOMINATOR;

        // Redeemable amount is the post-penalty amount
        return assets - penalty;
    }

    /**
        @notice Preview the amount of shares a user would need to redeem the specified asset amount
        @param  assets  uint256  Assets
        @return uint256  Shares
     */
    function previewWithdraw(uint256 assets)
        public
        view
        override
        returns (uint256)
    {
        uint256 supply = totalSupply;

        return
            supply == 0
                ? assets
                : assets.mulDivUp(supply, totalAssets()) /
                    ((FEE_DENOMINATOR - withdrawalPenalty) / FEE_DENOMINATOR);
    }
}
