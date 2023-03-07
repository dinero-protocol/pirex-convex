// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "openzeppelin/lib/forge-std/src/Script.sol";
import {LpxCvx} from "../LpxCvx.sol";

contract DeployLpxCvx is Script {
    address public _pxCVX = address(0xBCe0Cf87F513102F22232436CCa2ca49e815C3aC);
    address public _CVX = address(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);
    address public _pirexCvx =
        address(0x35A398425d9f1029021A92bc3d2557D42C8588D7);
    address public _rewardReceiver =
        address(0x6ED9c171E02De08aaEDF0Fc1D589923D807061D6);

    function run() public {
        vm.startBroadcast();
        new LpxCvx(_pxCVX, _CVX, _pirexCvx, _rewardReceiver);
        vm.stopBroadcast();
    }
}
