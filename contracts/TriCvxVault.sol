// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {ERC1155SupplyUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TriCvxVault is ERC1155SupplyUpgradeable {
    using SafeERC20 for ERC20;

    struct Underlying {
        address token;
        uint256 amount;
    }

    Underlying[] public bribes;

    uint256 public immutable VOTE_CVX = 0;
    uint256 public immutable BRIBE_CVX = 1;
    uint256 public immutable REWARD_CVX = 2;

    address public vaultController;
    address public rewardClaimer;
    uint256 public mintDeadline;

    // Used in the event of a previously-added bribe needing to be updated
    mapping(address => uint256) bribeIndexByToken;

    event Initialized(address _vaulController, uint256 _mintDeadline);
    event SetRewardClaimer(address _rewardClaimer);
    event Minted(address indexed to, uint256 amount);
    event AddedBribe(address token, uint256 amount);
    event Withdraw(
        address indexed from,
        address indexed to,
        address[] withdrawnTokens,
        uint256[] withdrawnAmounts
    );

    error ZeroAmount();
    error ZeroAddress();
    error ZeroBalance();
    error EmptyString();
    error BeforeMintDeadline();
    error AfterMintDeadline();
    error NotVaultController();
    error NotRewardClaimer();

    function initialize(address _vaultController, uint256 _mintDeadline)
        external
        initializer
    {
        if (_vaultController == address(0)) revert ZeroAddress();
        vaultController = _vaultController;

        if (_mintDeadline == 0) revert ZeroAmount();
        mintDeadline = _mintDeadline;

        emit Initialized(_vaultController, _mintDeadline);
    }

    modifier onlyVaultController() {
        if (msg.sender != vaultController) revert NotVaultController();
        _;
    }

    modifier onlyRewardClaimer() {
        if (msg.sender != rewardClaimer) revert NotRewardClaimer();
        _;
    }

    /**
        @notice Set reward claimer
        @param  _rewardClaimer  address  Reward claimer
     */
    function setRewardClaimer(address _rewardClaimer)
        external
        onlyVaultController
    {
        if (_rewardClaimer == address(0)) revert ZeroAddress();
        rewardClaimer = _rewardClaimer;

        emit SetRewardClaimer(_rewardClaimer);
    }

    /**
        @notice Mint vote, bribe, and reward CVX
        @param  to      address  Recipient
        @param  amount  uint256  Amount
     */
    function mint(address to, uint256 amount) external onlyVaultController {
        if (mintDeadline < block.timestamp) revert AfterMintDeadline();
        if (amount == 0) revert ZeroAmount();

        uint256[] memory ids = new uint256[](3);
        ids[0] = VOTE_CVX;
        ids[1] = BRIBE_CVX;
        ids[2] = REWARD_CVX;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = amount;
        amounts[1] = amount;
        amounts[2] = amount;

        // Validates `to`, `ids`, and `amounts`
        _mintBatch(to, ids, amounts, "");

        emit Minted(to, amount);
    }

    /**
        @notice Add a bribe
        @param  token  address  Bribe token address
     */
    function addBribe(address token) external onlyRewardClaimer {
        if (token == address(0)) revert ZeroAddress();

        uint256 bribeIndex = bribeIndexByToken[token];
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroBalance();

        // Add bribe if it doesn't exist
        if (
            bribes.length == 0 ||
            (bribeIndex == 0 && bribes[bribeIndex].amount == 0)
        ) {
            bribes.push(Underlying({token: token, amount: balance}));
            bribeIndexByToken[token] = bribes.length - 1;
        } else {
            // Update bribe
            bribes[bribeIndex] = Underlying({token: token, amount: balance});
        }

        emit AddedBribe(token, balance);
    }

    /** 
        @notice Redeem bribes
        @param  to              address  Recipient
        @param  bribeCvxAmount  uint256  Amount of bribeCVX
    */
    function redeemBribes(address to, uint256 bribeCvxAmount)
        external
        returns (
            address[] memory withdrawnTokens,
            uint256[] memory withdrawnAmounts
        )
    {
        if (mintDeadline > block.timestamp) revert BeforeMintDeadline();
        if (to == address(0)) revert ZeroAddress();
        if (bribeCvxAmount == 0) revert ZeroAmount();

        uint256 totalSupplyBeforeBurn = totalSupply(BRIBE_CVX);

        // // Burn the provided amount of shares.
        // // This will revert if the user does not have enough shares.
        _burn(msg.sender, BRIBE_CVX, bribeCvxAmount);

        // // Withdraw from strategies if needed and transfer.
        // beforeWithdraw(underlyingAmount);

        uint256 bLen = bribes.length;

        withdrawnTokens = new address[](bLen);
        withdrawnAmounts = new uint256[](bLen);

        // Iterate over bribes and transfer to recipient
        for (uint256 i; i < bLen; ++i) {
            withdrawnTokens[i] = bribes[i].token;
            withdrawnAmounts[i] =
                (bribes[i].amount * bribeCvxAmount) /
                totalSupplyBeforeBurn;

            ERC20(withdrawnTokens[i]).safeTransfer(to, withdrawnAmounts[i]);
        }

        emit Withdraw(msg.sender, to, withdrawnTokens, withdrawnAmounts);
    }
}
