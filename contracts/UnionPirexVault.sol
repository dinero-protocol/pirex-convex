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

    constructor(address _token, address _pirexCvx)
        ERC4626(ERC20(_token), "Union Pirex", "uCVX")
    {
        if (_pirexCvx == address(0)) revert ZeroAddress();
        pirexCvx = PirexCvx(_pirexCvx);
    }

    modifier notToZeroAddress(address _to) {
        require(_to != address(0), "Invalid address!");
        _;
    }

    /// @notice Updates the withdrawal penalty
    /// @param _penalty - the amount of the new penalty (in BIPS)
    function setWithdrawalPenalty(uint16 _penalty) external onlyOwner {
        require(_penalty <= MAX_WITHDRAWAL_PENALTY);
        withdrawalPenalty = _penalty;
        emit WithdrawalPenaltyUpdated(_penalty);
    }

    /// @notice Updates the caller incentive for harvests
    /// @param _incentive - the amount of the new incentive (in BIPS)
    function setCallIncentive(uint8 _incentive) external onlyOwner {
        require(_incentive <= MAX_CALL_INCENTIVE);
        callIncentive = _incentive;
        emit CallerIncentiveUpdated(_incentive);
    }

    /// @notice Updates the part of yield redirected to the platform
    /// @param _fee - the amount of the new platform fee (in BIPS)
    function setPlatformFee(uint16 _fee) external onlyOwner {
        require(_fee <= MAX_PLATFORM_FEE);
        platformFee = _fee;
        emit PlatformFeeUpdated(_fee);
    }

    /// @notice Updates the address to which platform fees are paid out
    /// @param _platform - the new platform wallet address
    function setPlatform(address _platform)
        external
        onlyOwner
        notToZeroAddress(_platform)
    {
        platform = _platform;
        emit PlatformUpdated(_platform);
    }

    /// @notice Set the address of the strategy contract
    /// @dev Can only be set once
    /// @param _strategy - address of the strategy contract
    function setStrategy(address _strategy)
        external
        onlyOwner
        notToZeroAddress(_strategy)
    {
        if (_strategy == address(0)) revert ZeroAddress();
        if (address(strategy) != address(0))
            pirexCvx.approve(address(strategy), 0);
        strategy = UnionPirexStaking(_strategy);
        pirexCvx.approve(_strategy, type(uint256).max);
        emit StrategySet(_strategy);
    }

    /**
        @notice Get the assets (pxCVX) currently custodied by the UnionPirex contracts
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
        // Call withdraw on the staking contract
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
        @param  shares   uint256  Shares
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

        // Calculate a penalty if user is not the last to withdraw
        uint256 penalty = totalSupply == 0
            ? 0
            : (assets * withdrawalPenalty) / FEE_DENOMINATOR;

        // Redeemed amount is the post-penalty amount
        return assets - penalty;
    }

    /**
        @notice Preview the amount of shares a user would need to redeem the specified asset amount
        @param  assets   uint256  Assets
        @return uint256  Shares
     */
    function previewWithdraw(uint256 assets)
        public
        view
        override
        returns (uint256)
    {
        uint256 supply = totalSupply;
        uint256 shares = supply == 0
            ? assets
            : assets.mulDivUp(supply, totalAssets());

        return
            shares = supply == 0
                ? assets
                : assets.mulDivUp(supply, totalAssets()) /
                    ((FEE_DENOMINATOR - withdrawalPenalty) / FEE_DENOMINATOR);
    }
}
