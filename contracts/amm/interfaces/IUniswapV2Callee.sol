pragma solidity >=0.5.0;

// https://github.com/Uniswap/v2-core/tree/master/contracts/interfaces/IUniswapV2Callee.sol

interface IUniswapV2Callee {
    function uniswapV2Call(address sender, uint amount0, uint amount1, bytes calldata data) external;
}
