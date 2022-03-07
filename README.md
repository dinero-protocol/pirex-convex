# Pirex

Our protocol provides a similar experience to locking CVX directly with the Convex protocol, with these added benefits:
- Users can sell their vlCVX at any time
- Users can sell 16 weeks' worth of bribes prior to their voting rounds
- Users will receive PRX tokens which entitles them to a share of protocol fees

And more

### Setup

IDE: VSCode 1.65 (Universal)

Node: 16.13.1

NPM: 8.1.2

1. Create a `.env` file with the same variables as `.env.example` and set them
2. Install global and local dependencies
`npm i -g typescript && npm i`
3. Compile contracts and run tests to ensure the project is set up correctly
`npx hardhat compile && npx hardhat test`

### Contract Overview

**VaultController.sol** (1 instance deployed)
- Deploys, sets up, and tracks LockedCvxVault, RewardCvxVault, and RewardClaimer contract instances
- Implements a time-based structure for protocol operations (e.g. deploys and initializes vaults with data for gating actions before/after a certain time, mints users vault shares for a sequence of epochs, etc.)
- Routes key method calls (e.g. deposit underlying, share redemptions, etc.) to the correct contracts

_NOTE: An epoch is 2 weeks_

**LockedCvxVault.sol** (1 instance deployed per epoch)
- Provides an ERC4626 interface for securely depositing and redeeming CVX
- Integrates various Convex contracts for carrying out actions such as unlocking CVX, delegating vlCVX, etc.
- Tokenizes vlCVX and enables users to transfer ownership prior to their tokens' lock expiry

**RewardCvxVault.sol** (1 instance deployed per epoch)
- Tokenizes future bribes, staking emissions, and other incentives
- Securely custodies reward assets and enables their redemption
- Makes it possible to segregate an asset and its rights or benefits (e.g. CVX and its voting power or future bribes)

**RewardClaimer.sol** (1 instance deployed per epoch)
- Handles reward-claiming for a variety of protocols (e.g. Convex, Votium, etc.)
- Transfers rewards - as they are claimed - to the appropriate RewardCvxVault and updates its state
- Provides the means for custom reward management in the future 

![Contract Diagram](https://i.imgur.com/g9WKF73.png)
_<p align="center">CVX deposit (order: green, blue, orange, purple)</p>_

### User Roles

- Owner: Work-in-progress
- VaultController: Has permission to call sensitive vault methods for minting rewardCVX and delegating votes
- RewardClaimer: Has permission to update the state of RewardCvxVaults to reflect the reward balances

### Action-chain: CVX Deposit-Redemption

A series of actions, from CVX deposit to redemption (in this example, only the VaultController is deployed)
1. Alice calls `deposit` on the VaultController contract, specifying 100 CVX as the amount
2. VaultController checks for the existence of a LockedCvxVault for the current epoch. It does not exist, so it carries out the process of deploying and setting up 1 LockedCvxVault, 8 RewardCvxVaults, and 1 RewardClaimer by calling `setUpVaults`
3. VaultController calls `deposit` on the LockedCvxVault contract, which results in 100 lockedCVX being minted for Alice and 100 CVX being locked with Convex
4. VaultController calls `_mintRewardCvxTokens` which mints 800 rewardCVX for Alice - 100 rewardCVX per Convex gauge-weight voting round (8 rounds in total during the CVX locking period) on each RewardCvxVault
5. Alice is bullish on CVX but wants to take off risk in the face of a potential bear market. She sells all 800 rewardCVX - capturing 16 weeks of bribe revenue in an instant

_17-19 weeks later (depending on when Alice deposited in the epoch)..._

6. Alice calls `redeem` on the VaultController contract, specifying 100 lockedCVX as the amount
7. VaultController transfers the lockedCVX to itself, calls `unlock` and `redeem` on the correct LockedCvxVault
8. LockedCvxVault burns the lockedCVX and transfers the unlocked CVX to Alice
