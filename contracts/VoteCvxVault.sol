// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.12;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract VoteCvxVault is ERC20Upgradeable {
    using SafeERC20 for ERC20;

    struct Rewards {
        address token;
        uint256 amount;
    }

    address public owner;
    uint256 public mintDeadline;
    Rewards[] public rewards;
    mapping(address => uint256) rewardIndexes;

    event Minted(address indexed to, uint256 amount);
    event AddedReward(address token, uint256 amount);

    error ZeroAmount();
    error ZeroAddress();
    error EmptyString();
    error AfterMintDeadline(uint256 timestamp);

    function initialize(
        uint256 _mintDeadline,
        string memory _name,
        string memory _symbol
    ) external initializer {
        owner = msg.sender;

        if (_mintDeadline == 0) revert ZeroAmount();
        mintDeadline = _mintDeadline;

        if (bytes(_name).length == 0) revert EmptyString();
        if (bytes(_symbol).length == 0) revert EmptyString();
        __ERC20_init_unchained(_name, _symbol);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Caller is not the owner");
        _;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        if (mintDeadline < block.timestamp)
            revert AfterMintDeadline(block.timestamp);
        _mint(to, amount);

        emit Minted(to, amount);
    }

    /**
        @notice Add a reward based on token balance
        @notice Restricted to owner (VaultController) to prevent random tokens
        @param  token  address  Reward token address
     */
    function addReward(address token) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();

        uint256 rewardIndex = rewardIndexes[token];
        uint256 balance = ERC20(token).balanceOf(address(this));

        // Add reward token if it doesn't exist
        if (rewards.length == 0 || (rewardIndex == 0 && rewards[rewardIndex].token == address(0))) {
            rewards.push(Rewards({token: token, amount: balance}));            
            rewardIndexes[token] = rewards.length - 1;
        } else {
            // Reward updates are necessary if Votium updates its claims with missing/additional rewards
            rewards[rewardIndex] = Rewards({
                token: token,
                amount: balance
            });
        }

        emit AddedReward(token, balance);
    }
}
