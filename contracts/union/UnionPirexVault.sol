// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC4626} from "@rari-capital/solmate/src/mixins/ERC4626.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {ReentrancyGuard} from "@rari-capital/solmate/src/utils/ReentrancyGuard.sol";
import {FixedPointMathLib} from "@rari-capital/solmate/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {PxCvx} from "../PxCvx.sol";
import {UnionPirexStaking} from "./UnionPirexStaking.sol";

contract UnionPirexVault is ReentrancyGuard, AccessControl, ERC4626 {
    using SafeTransferLib for ERC20;
    using FixedPointMathLib for uint256;

    UnionPirexStaking public strategy;

    uint256 public constant MAX_WITHDRAWAL_PENALTY = 500;
    uint256 public constant MAX_PLATFORM_FEE = 2000;
    uint256 public constant FEE_DENOMINATOR = 10000;

    uint256 public withdrawalPenalty = 300;
    uint256 public platformFee = 500;
    address public platform;

    event Harvest(address indexed _caller, uint256 _value);
    event WithdrawalPenaltyUpdated(uint256 _penalty);
    event PlatformFeeUpdated(uint256 _fee);
    event PlatformUpdated(address indexed _platform);
    event StrategySet(address indexed _strategy);

    error ZeroAddress();
    error ExceedsMax();

    constructor(address _pxCvx) ERC4626(ERC20(_pxCvx), "Union Pirex", "uCVX") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /**
        @notice Set the withdrawal penalty
        @param _penalty  uint256  Withdrawal penalty
     */
    function setWithdrawalPenalty(uint256 _penalty)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_penalty > MAX_WITHDRAWAL_PENALTY) revert ExceedsMax();
        withdrawalPenalty = _penalty;
        emit WithdrawalPenaltyUpdated(_penalty);
    }

    /**
        @notice Set the platform fee
        @param _fee  uint16  Platform fee
     */
    function setPlatformFee(uint256 _fee)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_fee > MAX_PLATFORM_FEE) revert ExceedsMax();
        platformFee = _fee;
        emit PlatformFeeUpdated(_fee);
    }

    /**
        @notice Set the platform
        @param _platform  address  Platform
     */
    function setPlatform(address _platform)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_platform == address(0)) revert ZeroAddress();
        platform = _platform;
        emit PlatformUpdated(_platform);
    }

    /**
        @notice Set the strategy
        @param _strategy  address  Strategy
     */
    function setStrategy(address _strategy)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (_strategy == address(0)) revert ZeroAddress();

        // Store old strategy to perform maintenance if needed
        address oldStrategy = address(strategy);

        // Set new strategy contract and approve max allowance
        strategy = UnionPirexStaking(_strategy);
        asset.safeApprove(_strategy, type(uint256).max);

        // Set allowance of previous strategy to 0
        if (oldStrategy != address(0)) {
            asset.safeApprove(oldStrategy, 0);

            // Migrate previous strategy balance to new strategy
            uint256 balance = UnionPirexStaking(oldStrategy).totalSupply();
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
        // Vault assets should always be stored in the staking contract until withdrawal-time
        return strategy.totalSupply();
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

        // Calculate a penalty - zero if user is the last to withdraw
        uint256 penalty = (totalSupply == 0 || totalSupply - shares == 0)
            ? 0
            : assets.mulDivDown(withdrawalPenalty, FEE_DENOMINATOR);

        // Redeemable amount is the post-penalty amount
        return assets - penalty;
    }

    /**
        @notice Preview the amount of shares a user would need to redeem the specified asset amount
        @notice This modified version takes into consideration the withdrawal fee
        @param  assets  uint256  Assets
        @return uint256  Shares
     */
    function previewWithdraw(uint256 assets)
        public
        view
        override
        returns (uint256)
    {
        // Calculate shares based on the specified assets' proportion of the pool
        uint256 shares = convertToShares(assets);

        // Factor in additional shares to fulfill withdrawal if user is not the last to withdraw
        return
            (totalSupply == 0 || totalSupply - shares == 0)
                ? shares
                : (shares * FEE_DENOMINATOR) /
                    (FEE_DENOMINATOR - withdrawalPenalty);
    }

    /**
        @notice Harvest rewards - should be called before any method relying on up-to-date total assets
     */
    function harvest() public {
        // Claim rewards
        strategy.getReward();

        // Since we don't normally store pxCVX within the vault, a non-zero balance equals rewards
        uint256 rewards = asset.balanceOf(address(this));

        emit Harvest(msg.sender, rewards);

        if (rewards != 0) {
            // Fee for platform
            uint256 feeAmount = (rewards * platformFee) / FEE_DENOMINATOR;

            // Claimed rewards should be in pxCVX
            asset.safeTransfer(platform, feeAmount);

            // Deduct fee from reward balance and stake remainder
            rewards -= feeAmount;

            strategy.stake(rewards);
        }
    }

    /**
        @notice Overridden solely to add harvest and nonReentrant modifiers 
     */
    function deposit(uint256 assets, address receiver)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        if (receiver == address(0)) revert ZeroAddress();

        harvest();

        // Check for rounding error since we round down in previewDeposit.
        require((shares = previewDeposit(assets)) != 0, "ZERO_SHARES");

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);

        afterDeposit(assets, shares);
    }

    /**
        @notice Overridden solely to add harvest and nonReentrant modifiers 
     */
    function mint(uint256 shares, address receiver)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        if (receiver == address(0)) revert ZeroAddress();

        harvest();

        assets = previewMint(shares); // No need to check for rounding error, previewMint rounds up.

        // Need to transfer before minting or ERC777s could reenter.
        asset.safeTransferFrom(msg.sender, address(this), assets);

        _mint(receiver, shares);

        emit Deposit(msg.sender, receiver, assets, shares);

        afterDeposit(assets, shares);
    }

    /**
        @notice Overridden solely to add harvest and nonReentrant modifiers 
     */
    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) public override nonReentrant returns (uint256 shares) {
        if (receiver == address(0)) revert ZeroAddress();
        if (owner == address(0)) revert ZeroAddress();

        harvest();

        shares = previewWithdraw(assets); // No need to check for rounding error, previewWithdraw rounds up.

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender]; // Saves gas for limited approvals.

            if (allowed != type(uint256).max)
                allowance[owner][msg.sender] = allowed - shares;
        }

        beforeWithdraw(assets, shares);

        _burn(owner, shares);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);

        asset.safeTransfer(receiver, assets);
    }

    /**
        @notice Overridden solely to add harvest and nonReentrant modifiers 
     */
    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) public override nonReentrant returns (uint256 assets) {
        if (receiver == address(0)) revert ZeroAddress();

        harvest();

        if (msg.sender != owner) {
            uint256 allowed = allowance[owner][msg.sender]; // Saves gas for limited approvals.

            if (allowed != type(uint256).max)
                allowance[owner][msg.sender] = allowed - shares;
        }

        // Check for rounding error since we round down in previewRedeem.
        require((assets = previewRedeem(shares)) != 0, "ZERO_ASSETS");

        beforeWithdraw(assets, shares);

        _burn(owner, shares);

        emit Withdraw(msg.sender, receiver, owner, assets, shares);

        asset.safeTransfer(receiver, assets);
    }
}
