// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import "hardhat/console.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RewardCvxVault is ERC20Upgradeable {
    using SafeERC20 for ERC20;

    struct Underlying {
        address token;
        uint256 amount;
    }

    Underlying[] public bribes;

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

    function initialize(
        address _vaultController,
        uint256 _mintDeadline,
        string memory _name,
        string memory _symbol
    ) external initializer {
        if (_vaultController == address(0)) revert ZeroAddress();
        vaultController = _vaultController;

        if (_mintDeadline == 0) revert ZeroAmount();
        mintDeadline = _mintDeadline;

        __ERC20_init_unchained(_name, _symbol);

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

        // Validates `to`
        _mint(to, amount);

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
        @param  to               address  Recipient
        @param  rewardCvxAmount  uint256  Amount of rewardCVX
    */
    function redeemBribes(address to, uint256 rewardCvxAmount)
        external
        returns (
            address[] memory withdrawnTokens,
            uint256[] memory withdrawnAmounts
        )
    {
        if (mintDeadline > block.timestamp) revert BeforeMintDeadline();
        if (to == address(0)) revert ZeroAddress();
        if (rewardCvxAmount == 0) revert ZeroAmount();

        uint256 totalSupplyBeforeBurn = totalSupply();

        // // Burn the provided amount of shares.
        // // This will revert if the user does not have enough shares.
        _burn(msg.sender, rewardCvxAmount);

        uint256 bLen = bribes.length;
        withdrawnTokens = new address[](bLen);
        withdrawnAmounts = new uint256[](bLen);

        // Iterate over bribes and transfer to recipient
        for (uint256 i; i < bLen; ++i) {
            withdrawnTokens[i] = bribes[i].token;
            withdrawnAmounts[i] =
                (bribes[i].amount * rewardCvxAmount) /
                totalSupplyBeforeBurn;

            ERC20(withdrawnTokens[i]).safeTransfer(to, withdrawnAmounts[i]);
        }

        emit Withdraw(msg.sender, to, withdrawnTokens, withdrawnAmounts);
    }
}
