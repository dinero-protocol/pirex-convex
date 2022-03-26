// SPDX-License-Identifier: MIT
pragma solidity 0.8.12;

import "@rari-capital/solmate/src/mixins/ERC4626.sol";
import {PirexCvx} from "./PirexCvx.sol";

contract UnionPirexVault is ERC4626 {
    PirexCvx public immutable pirex;

    error ZeroAddress();
    error EmptyString();

    constructor(
        ERC20 _asset,
        string memory _name,
        string memory _symbol
    ) ERC4626(_asset, _name, _symbol) {
        if (address(_asset) == address(0)) revert ZeroAddress();
        pirex = PirexCvx(address(_asset));

        if (bytes(_name).length == 0 || bytes(_symbol).length == 0)
            revert EmptyString();
    }

    function totalAssets() public view override returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
