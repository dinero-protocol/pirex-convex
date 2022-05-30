# Pirex

### General

Liquid vote-locked Convex with the ability to sell your future bribes and votes and collect upfront liquidity.

We have a "difficulty mode" which we hope will allow us to cater to every type of user:

- Easy mode: Deposit CVX and we'll auto-compound your bribes every round into more pxCVX
- Intermediate mode: Mimic locking with Convex but with the added benefits of liquid CVX (pxCVX) and all 17 weeks' worth of your bribes tokenized
- Expert mode: Borrow against your pxCVX to buy more CVX, tokenize bribes for an arbitrary amount of rounds by staking, and more

Users can deposit CVX and manage their own pxCVX or let our partner Union compound their bribes into more pxCVX. Users will be able to collateralize both uCVX (UnionPirex vault shares) and/or pxCVX tokens and borrow against their value via Rari Capital's Fuse (coming in the near future).

And more!

### Overview

Pirex provides a similar experience to locking CVX directly with the Convex protocol, with these added benefits (to name a few):

- Fungible, liquid CVX wrapper token which be used as collateral for Fuse and more
- Native auto-compounding integration with our partners in crime, Alu and Benny from Llama Airforce/The Union
- Flexible CVX redemptions which allow users to withdraw their CVX anywhere from 1-17 weeks
- The ability to tokenize future yield and trade them freely with others (native marketplace coming soon)

### Setup

IDE: VSCode 1.66 (Universal)

Node: 16.14.2

NPM: 8.5.0

1. Create a `.env` file with the same variables as `.env.example` and set them
2. Install global and local dependencies
   `npm i -g typescript && npm i`
3. Compile contracts and run tests to ensure the project is set up correctly
   - Hardhat tests: `npx hardhat compile && npx hardhat test` (`npx hardhat clean` may be required if an older version is cached)
   - Forge tests: `forge test --fork-url <RPC_PROVIDER>`

### Core Contract Overview

**PirexCvx.sol**

- Custodies deposited CVX and manages it through interactions with Convex's contracts
- Has the ability to mint tokenized components of vlCVX (i.e. pxCVX, upxCVX, and spxCVX) and derivatives (i.e. futures notes: rpxCVX and vpxCVX)
- Claims rewards from Votium and Convex and maintains the logic for their distribution

**PxCvx.sol**

- Enables the PirexCvx contract to perform token-related operations for pxCVX (e.g. mint, burn, etc.)
- Takes token balance snapshots to enable solely on-chain reward redemptions by pxCVX holders over a period of epochs
- Maintains general protocol state related to epochs, rewards, and token balances

**PirexCvxConvex.sol**

- Provides an interface to Convex contract methods that are relevant to the Pirex protocol
- Allows the protocol to be paused and provides emergency methods to handle unforeseen events (e.g. [this mass Convex unlock on March 4, 2022](https://convexfinance.medium.com/vote-locked-cvx-contract-migration-8546b3d9a38c))

**PirexFees.sol**

- Distributes protocol fees to stakeholders

**UnionPirexVault.sol**

- Offers an ERC-4626 interface for pxCVX deposits and withdrawals, while taking into consideration protocol fees when computing asset/share values
- Works in conjunction with the UnionPirexStrategy contract for streaming rewards

**UnionPirexStrategy.sol**
- Utilizes a modified version of Synthetix's StakingRewards contract to stream rewards over 14-day periods
