# Pirex

### General

Liquid vote-locked Convex with the ability to sell your future bribes and votes and collect upfront liquidity.

We have a "difficulty mode" for every type of user:

- Easy mode: Deposit CVX and we will auto-compound your bribes every round into more liquid pCVX
- Intermediate mode: Deposit your CVX and unlock in 17 weeks - same as Convex - but get all 17 weeks of your bribes upfront in the form of tokens. Sell, trade, or keep them - it’s up to you
- Expert mode: Deposit your CVX, sell your bribes upfront or borrow against your CVX to buy more CVX. Rinse and repeat

Users can deposit CVX and manage their own pCVX or let our partner Union compound their bribes into more pCVX. Users will be able to collateralize both uCVX (UnionPirex vault shares) and/or pCVX tokens and borrow against them.

And more!

### Overview

Pirex provides a similar experience to locking CVX directly with the Convex protocol, with these added benefits (to name a few):

- Fungible, liquid CVX wrapper token which be used as collateral for Fuse and more
- Native auto-compounding integration with our partners in crime, Alu and Benny from the Union
- Flexible CVX redemptions which allow users to withdraw their CVX anywhere from 1-17 weeks
- No upfront fees - Pirex's goal is to provide the user with the same APR as Convex and will only share in any surplus
- Efficient and novel ERC1155-based system used for segregating tokens by time
  - upCVX: Represents CVX being unlocked which can be redeemed after a specific timestamp
  - rpCVX: Represents bribes which can be claimed for a specific Convex voting round
  - vpCVX: Represents votes which can be used for a specific Convex voting round
  - spCVX: Represents pCVX which can be unstaked after a specific timestamp

### Setup

IDE: VSCode 1.66 (Universal)

Node: 16.14.2

NPM: 8.5.0

1. Create a `.env` file with the same variables as `.env.example` and set them
2. Install global and local dependencies
   `npm i -g typescript && npm i`
3. Compile contracts and run tests to ensure the project is set up correctly
   `npx hardhat compile && npx hardhat test` (`npx hardhat clean` may be required if an older version is cached)

### Core Contract Overview

**PirexCvx.sol**

- Custodies deposited CVX and manages it through interactions with Convex's contracts
- Produces tokenized versions of vlCVX (i.e. pCVX, upCVX, and spCVX) and derivatives (i.e. futures notes: rpCVX and vpCVX)
- Claims rewards from Votium and Convex and maintains the logic for their distribution

**PirexCvxConvex.sol**

- Provides an interface to Convex contract methods that are relevant to the Pirex protocol
- Allows the protocol to be paused and provides emergency methods to handle unforeseen events (e.g. [this mass Convex unlock on March 4, 2022](https://convexfinance.medium.com/vote-locked-cvx-contract-migration-8546b3d9a38c))

**PirexFees.sol**

- Distributes protocol fees to stakeholders
- Offers a variety of methods for security and administrative purposes (e.g. granting/revoking roles and updating fee recipient addresses)

**UnionPirexVault.sol**

Work-in-progress! See [this implementation](https://github.com/convex-community/union_contracts/tree/feat/pcvx/contracts/strategies/pCVX) by our partners, the Union, which will be continuously updated.

### User Roles

- Owner: Pirex 3/5 multi-sig that has permission to call owner-only methods within the PirexCvx and PirexCvxConvex contract
- Admin: Pirex 3/5 multi-sig that has permission to call admin-only methods within the PirexFees contract
- Fee Distributor: Addresses that have permission to call the PirexFees contract's `distributeFees` method
