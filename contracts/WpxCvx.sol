// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@rari-capital/solmate/src/utils/ReentrancyGuard.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {PirexCvx} from "./PirexCvx.sol";
import {ICurvePool} from "./interfaces/ICurvePool.sol";

contract WpxCvx is ERC20, Ownable, ReentrancyGuard {
    using SafeTransferLib for ERC20;

    // Enumeration for the token swap
    enum Token {
        CVX,
        pxCVX
    }

    ERC20 public immutable pxCVX;
    ERC20 public immutable CVX;

    PirexCvx public pirexCvx;

    // Contract of the curvePool for the CVX/wpxCVX pair
    ICurvePool public curvePool;

    // Receiver of the redeemed snapshot rewards from pirexCvx
    address public rewardReceiver;

    event SetPirexCvx(address pirexCvx);
    event SetCurvePool(address curvePool);
    event SetRewardReceiver(address rewardReceiver);

    error ZeroAddress();
    error ZeroAmount();
    error PoolNotSet();

    /**
        @notice The curvePool has to be set after as the pool can only be created after deploying wpxCVX 
        @param  _pxCVX           address  pxCVX address
        @param  _CVX             address  CVX address
        @param  _pirexCvx        address  pirexCvx address
        @param  _rewardReceiver  address  Reward receiver address
     */
    constructor(
        address _pxCVX,
        address _CVX,
        address _pirexCvx,
        address _rewardReceiver
    ) ERC20("Wrapped Pirex CVX", "wpxCVX", 18) {
        if (_pxCVX == address(0)) revert ZeroAddress();
        if (_CVX == address(0)) revert ZeroAddress();
        if (_pirexCvx == address(0)) revert ZeroAddress();
        if (_rewardReceiver == address(0)) revert ZeroAddress();

        pxCVX = ERC20(_pxCVX);
        CVX = ERC20(_CVX);
        pirexCvx = PirexCvx(_pirexCvx);
        rewardReceiver = _rewardReceiver;
    }

    /** 
        @notice Set the pirexCvx contract, should only be called on emergency migration
        @param  _pirexCvx  address  New pirexCvx address
     */
    function setPirexCvx(address _pirexCvx) external onlyOwner {
        if (_pirexCvx == address(0)) revert ZeroAddress();

        pirexCvx = PirexCvx(_pirexCvx);

        emit SetPirexCvx(_pirexCvx);
    }

    /** 
        @notice Set the curvePool contract for the CVX/wpxCVX pair
        @param  _curvePool  address  New curvePool address
     */
    function setCurvePool(address _curvePool) external onlyOwner {
        if (_curvePool == address(0)) revert ZeroAddress();

        emit SetCurvePool(_curvePool);

        address oldCurvePool = address(curvePool);

        // Clear out approvals for old pool contract when needed
        if (oldCurvePool != address(0)) {
            ERC20(address(this)).safeApprove(oldCurvePool, 0);
            CVX.safeApprove(oldCurvePool, 0);
        }

        // Set the approval on both wpxCVX and CVX for the new pool contract
        curvePool = ICurvePool(_curvePool);
        ERC20(address(this)).safeApprove(_curvePool, type(uint256).max);
        CVX.safeApprove(_curvePool, type(uint256).max);
    }

    /** 
        @notice Set the reward receiver address
        @param  _rewardReceiver  address  New reward receiver address
     */
    function setRewardReceiver(address _rewardReceiver) external onlyOwner {
        if (_rewardReceiver == address(0)) revert ZeroAddress();

        rewardReceiver = _rewardReceiver;

        emit SetRewardReceiver(_rewardReceiver);
    }

    /**
        @notice Redeem pxCVX snapshot rewards and transfer them to the currently set receiver
        @param  epoch          uint256    Rewards epoch
        @param  rewardIndexes  uint256[]  Reward indexes
     */
    function redeemRewards(uint256 epoch, uint256[] calldata rewardIndexes)
        external
    {
        pirexCvx.redeemSnapshotRewards(epoch, rewardIndexes, rewardReceiver);
    }

    /** 
        @notice Wrap the specified amount of pxCVX into wpxCVX
        @param  amount  uint256  Amount of pxCVX
     */
    function wrap(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        pxCVX.safeTransferFrom(msg.sender, address(this), amount);

        _mint(msg.sender, amount);
    }

    /** 
        @notice Unwrap the specified amount of wpxCVX back into pxCVX
        @param  amount  uint256  Amount of wpxCVX
     */
    function unwrap(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        _burn(msg.sender, amount);

        pxCVX.safeTransfer(msg.sender, amount);
    }

    /** 
        @notice Swap the specified amount of source token into the counterpart token via the curvePool
        @param  source       enum     Source token
        @param  amount       uint256  Amount of source token
        @param  minReceived  uint256  Minimum received amount of counterpart token
     */
    function swap(
        Token source,
        uint256 amount,
        uint256 minReceived
    ) external nonReentrant {
        if (address(curvePool) == address(0)) revert PoolNotSet();
        if (amount == 0) revert ZeroAmount();
        if (minReceived == 0) revert ZeroAmount();

        if (source == Token.pxCVX) {
            // Transfer the pxCVX to the contract then mint the equivalent amount of wpxCVX
            pxCVX.safeTransferFrom(msg.sender, address(this), amount);
            _mint(address(this), amount);

            // Swap the wpxCVX for CVX
            uint256 oldBalance = CVX.balanceOf(address(this));
            curvePool.exchange(1, 0, amount, minReceived);

            // Transfer the actual received amount of CVX to the user
            CVX.safeTransfer(msg.sender, CVX.balanceOf(address(this)) - oldBalance);
        } else {
            // Transfer the CVX to the contract for the actual swap
            CVX.safeTransferFrom(msg.sender, address(this), amount);

            // Swap the CVX for wpxCVX and calculate the final received amount
            uint256 oldBalance = balanceOf[address(this)];
            curvePool.exchange(0, 1, amount, minReceived);
            uint256 newBalance = balanceOf[address(this)];
            uint256 received = newBalance - oldBalance;

            // Burn the received wpxCVX and transfer the equivalent amount of pxCVX to the user
            _burn(address(this), received);
            pxCVX.safeTransfer(msg.sender, received);
        }
    }
}
