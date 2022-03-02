// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import {ERC1155Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TriCvxVault is ERC1155Upgradeable {
    struct Rewards {
        address token;
        uint256 amount;
    }

    uint256 public immutable VOTE_CVX = 0;
    uint256 public immutable BRIBE_CVX = 1;
    uint256 public immutable REWARD_CVX = 2;

    address public vaultController;
    address public rewardClaimer;
    uint256 public mintDeadline;
    Rewards[] public rewards;
    mapping(address => uint256) rewardIndexesByToken;

    event Initialized(address _vaulController, uint256 _mintDeadline);
    event SetRewardClaimer(address _rewardClaimer);
    event Minted(address indexed to, uint256 amount);
    event AddedReward(address token, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error ZeroBalance();
    error EmptyString();
    error AfterMintDeadline(uint256 timestamp);
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
        if (mintDeadline < block.timestamp)
            revert AfterMintDeadline(block.timestamp);
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
        @notice Add a reward based on token balance
        @notice Restricted to rewardClaimer to prevent random tokens
        @param  token  address  Reward token address
     */
    function addReward(address token) external onlyRewardClaimer {
        if (token == address(0)) revert ZeroAddress();

        uint256 rewardIndex = rewardIndexesByToken[token];

        // Store balance - revert if zero
        uint256 balance = ERC20(token).balanceOf(address(this));
        if (balance == 0) revert ZeroBalance();

        // Add reward token if it doesn't exist
        if (
            rewards.length == 0 ||
            (rewardIndex == 0 && rewards[rewardIndex].token == address(0))
        ) {
            rewards.push(Rewards({token: token, amount: balance}));
            rewardIndexesByToken[token] = rewards.length - 1;
        } else {
            // Reward updates are necessary if Votium updates its claims with missing/additional rewards
            rewards[rewardIndex] = Rewards({token: token, amount: balance});
        }

        emit AddedReward(token, balance);
    }
}
