// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import {SafeTransferLib} from "@rari-capital/solmate/src/utils/SafeTransferLib.sol";
import {ERC20} from "@rari-capital/solmate/src/tokens/ERC20.sol";
import {ICurvePool} from "../interfaces/ICurvePool.sol";

interface ICurveDeployer {
    function deploy_pool(
        string calldata name,
        string calldata symbol,
        address[2] calldata coins,
        uint256 a,
        uint256 gamma,
        uint256 midFee,
        uint256 outFee,
        uint256 extraProfit,
        uint256 feeGamma,
        uint256 adjustmentStep,
        uint256 adminFee,
        uint256 maHalfTime,
        uint256 initialPrice
    ) external payable;

    function find_pool_for_coins(
        address from,
        address to,
        uint256 i
    ) external view returns (address);
}

contract CurvePoolHelper {
    using SafeTransferLib for ERC20;

    ICurveDeployer public deployer;
    ERC20 public CVX;
    ERC20 public wpxCVX;

    constructor(
        address _deployer,
        address _CVX,
        address _wpxCVX
    ) {
        deployer = ICurveDeployer(_deployer);
        CVX = ERC20(_CVX);
        wpxCVX = ERC20(_wpxCVX);

        address[2] memory pair = [_CVX, _wpxCVX];

        // Using suggested parameters for creating the pool with 1:1 price ratio
        deployer.deploy_pool(
            "CVX/wpxCVX",
            "CVXwpxCVX",
            pair,
            400000,
            145000000000000,
            26000000,
            45000000,
            2000000000000,
            230000000000000,
            146000000000000,
            5000000000,
            600,
            1000000000000000000
        );
    }

    function poolAddress() public view returns (address) {
        return deployer.find_pool_for_coins(address(CVX), address(wpxCVX), 0);
    }

    function initPool(uint256 amount1, uint256 amount2) external {
        address pool = poolAddress();
        uint256[2] memory amounts = [amount1, amount2];

        CVX.safeApprove(pool, type(uint256).max);
        wpxCVX.safeApprove(pool, type(uint256).max);

        ICurvePool(pool).add_liquidity(amounts, 0);
    }

    function getDy(uint256 i, uint256 j, uint256 amount) external view returns (uint256) {
        address pool = poolAddress();

        return ICurvePool(pool).get_dy(i, j, amount);
    }
}
