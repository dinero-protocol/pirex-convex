import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Promise } from "bluebird";
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
  impersonateAddressAndReturnSigner,
} from "./helpers";
import { BigNumber } from "ethers";
import {
  Cvx,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  MultiMerkleStash,
  MultiMerkleStash__factory,
  VotiumRewardManager,
} from "../typechain-types";
import { BalanceTree } from "../lib/merkle";

describe("PirexCvx", () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let votiumOwner: SignerWithAddress;
  let cvx: Cvx;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let pirexCvx: PirexCvx;
  let votiumRewardManager: VotiumRewardManager;
  let multiMerkleStash: MultiMerkleStash;
  let rewardToken: Cvx;
  let cvxLockerLockDuration: BigNumber;
  let firstDepositEpoch: BigNumber;
  let secondDepositEpoch: BigNumber;

  const crvAddr = "0xd533a949740bb3306d119cc777fa900ba034cd52";
  const crvDepositorAddr = "0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae";
  const cvxCrvRewardsAddr = "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e";
  const cvxCrvTokenAddr = "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7";
  const cvxDelegateRegistry = "0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446";
  const votiumMultiMerkleStash = "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A";
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;
  const convexDelegateRegistryId =
    "0x6376782e65746800000000000000000000000000000000000000000000000000";
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const lockedCvxPrefix = "lockedCVX";

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const CVX = await ethers.getContractFactory("Cvx");
    const CVXLocker = await ethers.getContractFactory("CvxLocker");
    const CVXRewardPool = await ethers.getContractFactory("CvxRewardPool");
    const PirexCVX = await ethers.getContractFactory("PirexCvx");
    const VotiumRewardManager = await ethers.getContractFactory(
      "VotiumRewardManager"
    );

    cvx = await CVX.deploy();
    cvxLocker = await CVXLocker.deploy(cvx.address);
    cvxRewardPool = await CVXRewardPool.deploy(
      cvx.address,
      crvAddr,
      crvDepositorAddr,
      cvxCrvRewardsAddr,
      cvxCrvTokenAddr,
      admin.address,
      admin.address
    );
    cvxLockerLockDuration = await cvxLocker.lockDuration();
    pirexCvx = await PirexCVX.deploy(
      cvxLocker.address,
      cvx.address,
      cvxRewardPool.address,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      initialEpochDepositDuration,
      cvxLockerLockDuration,
      admin.address
    );
    votiumRewardManager = await VotiumRewardManager.deploy(
      pirexCvx.address,
      cvx.address
    );

    // Setup Votium's multiMerkleStash by impersonating the Votium multisig
    multiMerkleStash = await MultiMerkleStash__factory.connect(
      votiumMultiMerkleStash,
      ethers.provider
    );
    const votiumMultisig = await multiMerkleStash.owner();
    votiumOwner = await impersonateAddressAndReturnSigner(
      admin,
      votiumMultisig
    );
    // Mock reward token
    rewardToken = await CVX.deploy();

    await cvxLocker.setStakingContract(
      "0xe096ccec4a1d36f191189fe61e803d8b2044dfc3"
    );
    await cvxLocker.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt("ERC20PresetMinterPauserUpgradeable", address);

  describe("constructor", () => {
    it("Should set up contract state", async () => {
      const owner = await pirexCvx.owner();
      const _cvxLocker = await pirexCvx.cvxLocker();
      const _cvx = await pirexCvx.cvx();
      const _cvxDelegateRegistry = await pirexCvx.cvxDelegateRegistry();
      const _votiumMultiMerkleStash = await pirexCvx.votiumMultiMerkleStash();
      const _epochDepositDuration = await pirexCvx.epochDepositDuration();
      const _lockDuration = await pirexCvx.lockDuration();
      const erc20Implementation = await pirexCvx.erc20Implementation();
      const voteDelegate = await pirexCvx.voteDelegate();
      const _votiumRewardManager = await pirexCvx.votiumRewardManager();

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry);
      expect(_votiumMultiMerkleStash).to.equal(votiumMultiMerkleStash);
      expect(_epochDepositDuration).to.equal(initialEpochDepositDuration);
      expect(_lockDuration).to.equal(cvxLockerLockDuration);
      expect(erc20Implementation).to.not.equal(zeroAddress);
      expect(voteDelegate).to.equal(admin.address);
      expect(_votiumRewardManager).to.equal(pirexCvx.address);
    });
  });

  describe("setVoteDelegate", () => {
    it("Should set voteDelegate", async () => {
      const voteDelegateBeforeSetting = await pirexCvx.voteDelegate();

      const setVoteDelegateEvent = await callAndReturnEvent(
        pirexCvx.setVoteDelegate,
        [convexDelegateRegistryId, notAdmin.address]
      );

      const voteDelegateAfterSetting = await pirexCvx.voteDelegate();

      expect(voteDelegateBeforeSetting).to.equal(admin.address);
      expect(voteDelegateBeforeSetting).to.not.equal(voteDelegateAfterSetting);
      expect(setVoteDelegateEvent.eventSignature).to.equal(
        "VoteDelegateSet(bytes32,address)"
      );
      expect(setVoteDelegateEvent.args.id).to.equal(convexDelegateRegistryId);
      expect(setVoteDelegateEvent.args.delegate).to.equal(notAdmin.address);
      expect(voteDelegateAfterSetting).to.equal(notAdmin.address);
    });

    it("Should revert if not called by owner", async () => {
      await expect(
        pirexCvx
          .connect(notAdmin)
          .setVoteDelegate(convexDelegateRegistryId, admin.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert if delegate is zero address", async () => {
      await expect(
        pirexCvx.setVoteDelegate(convexDelegateRegistryId, zeroAddress)
      ).to.be.revertedWith("Invalid delegate");
    });
  });

  describe("setVotiumRewardManager", () => {
    it("Should set votiumRewardManager", async () => {
      const votiumRewardManagerBeforeSetting =
        await pirexCvx.votiumRewardManager();

      const setVotiumRewardManagerEvent = await callAndReturnEvent(
        pirexCvx.setVotiumRewardManager,
        [notAdmin.address]
      );

      const votiumRewardManagerAfterSetting =
        await pirexCvx.votiumRewardManager();

      expect(votiumRewardManagerBeforeSetting).to.equal(pirexCvx.address);
      expect(votiumRewardManagerBeforeSetting).to.not.equal(
        votiumRewardManagerAfterSetting
      );
      expect(setVotiumRewardManagerEvent.eventSignature).to.equal(
        "VotiumRewardManagerSet(address)"
      );
      expect(setVotiumRewardManagerEvent.args.manager).to.equal(
        notAdmin.address
      );
      expect(votiumRewardManagerAfterSetting).to.equal(notAdmin.address);
    });

    it("Should revert if not called by owner", async () => {
      await expect(
        pirexCvx.connect(notAdmin).setVotiumRewardManager(admin.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("Should revert if manager is zero address", async () => {
      await expect(
        pirexCvx.setVotiumRewardManager(zeroAddress)
      ).to.be.revertedWith("Invalid manager");
    });
  });

  describe("getCurrentEpoch", () => {
    it("Should get the current epoch", async () => {
      const { timestamp } = await ethers.provider.getBlock("latest");
      const epochDepositDuration: number = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      expect(currentEpoch).to.equal(
        Math.floor(timestamp / epochDepositDuration) * epochDepositDuration
      );
    });
  });

  describe("deposit", () => {
    it("Should deposit CVX", async () => {
      // Move the timestamp to the beginning of next epoch to ensure consistent tests run
      const { timestamp } = await ethers.provider.getBlock("latest");
      const currentEpoch = convertBigNumberToNumber(
        await pirexCvx.getCurrentEpoch()
      );
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const timeUntilNextEpoch =
        currentEpoch + epochDepositDuration - timestamp;
      await increaseBlockTimestamp(timeUntilNextEpoch + 60); // Shift by 1 minute for safety

      const userCvxTokensBeforeDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxTokensBeforeDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);

      firstDepositEpoch = await pirexCvx.getCurrentEpoch();

      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);
      const rewardsDuration = convertBigNumberToNumber(
        await cvxLocker.rewardsDuration()
      );

      // Convex does not reflect actual locked CVX until their next epoch (1 week)
      await increaseBlockTimestamp(rewardsDuration);

      const userCvxTokensAfterDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxAfterDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );

      // Store to test withdrawing tokens for this specific epoch later
      const pirexCvxToken = await getPirexCvxToken(depositEvent.args.token);
      const userPirexCvxTokens = await pirexCvxToken.balanceOf(admin.address);
      const lockDuration = await pirexCvx.lockDuration();
      const expectedVoteEpochs = [...Array(8).keys()].map((_, idx) =>
        toBN(
          convertBigNumberToNumber(firstDepositEpoch) +
            epochDepositDuration * (idx + 1)
        )
      );
      const voteEpochTokenAddresses = await Promise.map(
        expectedVoteEpochs,
        async (voteEpoch: BigNumber) => await pirexCvx.voteEpochs(voteEpoch)
      );

      expect(userCvxTokensAfterDeposit).to.equal(
        userCvxTokensBeforeDeposit.sub(depositAmount)
      );
      expect(pirexLockedCvxAfterDeposit).to.equal(
        pirexLockedCvxTokensBeforeDeposit.add(depositAmount)
      );
      expect(depositEvent.eventSignature).to.equal(
        "Deposited(uint256,uint256,uint256,uint256,address,uint256[8])"
      );
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(depositEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(depositEvent.args.lockExpiry).to.equal(
        firstDepositEpoch.add(epochDepositDuration).add(lockDuration)
      );
      expect(depositEvent.args.token).to.not.equal(zeroAddress);
      expect(userPirexCvxTokens).to.equal(depositAmount);
      expect(depositEvent.args.voteEpochs).to.deep.equal(expectedVoteEpochs);
      expect(
        depositEvent.args.lockExpiry.gte(
          expectedVoteEpochs[expectedVoteEpochs.length - 1]
        )
      ).to.equal(true);
      expect(voteEpochTokenAddresses).to.not.include(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("Should mint the correct amount of user tokens on subsequent deposits", async () => {
      const currentEpoch = firstDepositEpoch;
      const { token, lockExpiry } = await pirexCvx.deposits(currentEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);
      const userPirexCvxTokensBeforeDeposit = await pirexCvxToken.balanceOf(
        admin.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);
      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);

      const userPirexCvxTokensAfterDeposit = await pirexCvxToken.balanceOf(
        admin.address
      );
      const { token: tokenAfterDeposit, lockExpiry: lockExpiryAfterDeposit } =
        await pirexCvx.deposits(currentEpoch);

      expect(userPirexCvxTokensAfterDeposit).to.equal(
        userPirexCvxTokensBeforeDeposit.add(depositAmount)
      );
      expect(token).to.equal(tokenAfterDeposit);
      expect(lockExpiry).to.equal(lockExpiryAfterDeposit);
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(depositEvent.args.epoch).to.equal(currentEpoch);
      expect(depositEvent.args.lockExpiry).to.equal(lockExpiry);
      expect(depositEvent.args.token).to.equal(token);
    });

    it("Should mint a new token for a new epoch", async () => {
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const currentEpoch = firstDepositEpoch;
      const { token: currentEpochToken } = await pirexCvx.deposits(
        currentEpoch
      );
      const pirexCvxTokenForCurrentEpoch = await getPirexCvxToken(
        currentEpochToken
      );
      const pirexCvxTokenForCurrentEpochName =
        await pirexCvxTokenForCurrentEpoch.name();
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const depositAmount = toBN(1e18);

      // Store to conveniently withdraw tokens for a specific epoch later
      secondDepositEpoch = nextEpoch;

      // Fast forward 1 epoch
      await increaseBlockTimestamp(epochDepositDuration);
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      const { token: nextEpochToken } = await pirexCvx.deposits(nextEpoch);
      const pirexCvxTokenForNextEpoch = await getPirexCvxToken(nextEpochToken);
      const pirexCvxTokenForNextEpochName =
        await pirexCvxTokenForNextEpoch.name();
      const userPirexCvxTokensForNextEpoch =
        await pirexCvxTokenForNextEpoch.balanceOf(admin.address);

      expect(pirexCvxTokenForCurrentEpochName).to.equal(
        `${lockedCvxPrefix}-${currentEpoch}`
      );
      expect(pirexCvxTokenForNextEpochName).to.equal(
        `${lockedCvxPrefix}-${nextEpoch}`
      );
      expect(pirexCvxTokenForCurrentEpoch.address).to.not.equal(
        pirexCvxTokenForNextEpoch.address
      );
      expect(userPirexCvxTokensForNextEpoch).to.equal(depositAmount);
    });
  });

  describe("withdraw", () => {
    it("Should revert if invalid epoch", async () => {
      await expect(pirexCvx.withdraw(0, defaultSpendRatio)).to.be.revertedWith(
        "Invalid epoch"
      );
    });

    it("Should revert if withdrawing CVX before lock expiry", async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      await expect(
        pirexCvx.withdraw(currentEpoch, defaultSpendRatio)
      ).to.be.revertedWith("Cannot withdraw before lock expiry");
    });

    it("Should withdraw CVX if after lock expiry (first epoch deposit)", async () => {
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const lockDuration = convertBigNumberToNumber(
        await pirexCvx.lockDuration()
      );
      const { token } = await pirexCvx.deposits(firstDepositEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);

      // Fast forward to after lock expiry
      await increaseBlockTimestamp(epochDepositDuration + lockDuration);

      const userPirexCvxTokensBeforeWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensBeforeWithdraw = await cvx.balanceOf(admin.address);
      const { unlockable: pirexUnlockableCvxTokensBeforeWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);
      const pirexStakedCvxTokensBeforeWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      await pirexCvxToken.approve(
        pirexCvx.address,
        userPirexCvxTokensBeforeWithdraw
      );

      const withdrawEvent = await callAndReturnEvent(pirexCvx.withdraw, [
        firstDepositEpoch,
        defaultSpendRatio,
      ]);
      const userPirexCvxTokensAfterWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensAfterWithdraw = await cvx.balanceOf(admin.address);
      const { unlockable: pirexUnlockableCvxTokensAfterWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);
      const pirexStakedCvxTokensAfterWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensAfterWithdraw = await cvx.balanceOf(pirexCvx.address);

      expect(userPirexCvxTokensAfterWithdraw).to.equal(0);
      expect(pirexUnlockableCvxTokensAfterWithdraw).to.equal(0);
      expect(pirexCvxTokensAfterWithdraw).to.equal(0);
      expect(userCvxTokensAfterWithdraw).to.equal(
        userCvxTokensBeforeWithdraw.add(userPirexCvxTokensBeforeWithdraw)
      );
      expect(withdrawEvent.eventSignature).to.equal(
        "Withdrew(uint256,uint256,uint256,uint256,address,uint256,uint256)"
      );
      expect(withdrawEvent.args.amount).to.equal(
        userPirexCvxTokensBeforeWithdraw
      );
      expect(withdrawEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(withdrawEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(withdrawEvent.args.lockExpiry).to.equal(
        firstDepositEpoch.add(epochDepositDuration).add(lockDuration)
      );
      expect(withdrawEvent.args.token).to.equal(pirexCvxToken.address);
      expect(withdrawEvent.args.unlocked).to.equal(
        pirexUnlockableCvxTokensBeforeWithdraw
      );
      expect(withdrawEvent.args.staked).to.equal(
        pirexUnlockableCvxTokensBeforeWithdraw.sub(
          userPirexCvxTokensBeforeWithdraw
        )
      );
      expect(pirexStakedCvxTokensAfterWithdraw).to.equal(
        pirexStakedCvxTokensBeforeWithdraw.add(
          pirexUnlockableCvxTokensBeforeWithdraw.sub(
            userPirexCvxTokensBeforeWithdraw
          )
        )
      );
    });

    it("Should revert if msg.sender does not have tokens for epoch", async () => {
      await expect(
        pirexCvx
          .connect(notAdmin)
          .withdraw(firstDepositEpoch, defaultSpendRatio)
      ).to.be.revertedWith("Msg.sender does not have lockedCVX for epoch");
    });

    it("Should withdraw CVX if after lock expiry (second epoch deposit)", async () => {
      const { token } = await pirexCvx.deposits(secondDepositEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);
      const userPirexCvxTokensBeforeWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensBeforeWithdraw = await cvx.balanceOf(admin.address);

      // There should not be any unlockable tokens since we unlocked them all
      const { unlockable: pirexUnlockableCvxTokensBeforeWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);

      // Staked tokens will need to be unstaked to complete deposit
      const pirexStakedCvxTokensBeforeWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      await pirexCvxToken.approve(
        pirexCvx.address,
        userPirexCvxTokensBeforeWithdraw
      );
      await pirexCvx.withdraw(secondDepositEpoch, defaultSpendRatio);

      const userPirexCvxTokensAfterWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensAfterWithdraw = await cvx.balanceOf(admin.address);
      const pirexStakedCvxTokensAfterWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(pirexUnlockableCvxTokensBeforeWithdraw).to.equal(0);
      expect(userPirexCvxTokensAfterWithdraw).to.equal(0);
      expect(userCvxTokensAfterWithdraw).to.equal(
        userCvxTokensBeforeWithdraw.add(userPirexCvxTokensBeforeWithdraw)
      );
      expect(pirexStakedCvxTokensAfterWithdraw).to.equal(
        pirexStakedCvxTokensBeforeWithdraw.add(
          pirexUnlockableCvxTokensBeforeWithdraw.sub(
            userPirexCvxTokensBeforeWithdraw
          )
        )
      );
    });
  });

  describe("stake", () => {
    it("Should revert if amount is 0", async () => {
      await expect(pirexCvx.stakeCvx(0)).to.be.revertedWith("Invalid amount");
    });

    it("Should revert if amount is greater than balance", async () => {
      await expect(pirexCvx.stakeCvx(`${1e18}`)).to.be.revertedWith(
        "ERC20: transfer amount exceeds balance"
      );
    });

    it("Should stake unlocked CVX", async () => {
      const depositAmount = toBN(1e18);
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const lockDuration = convertBigNumberToNumber(
        await pirexCvx.lockDuration()
      );

      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      // Fast forward to after lock expiry
      await increaseBlockTimestamp(epochDepositDuration + lockDuration);

      const { unlockable } = await cvxLocker.lockedBalances(pirexCvx.address);

      await pirexCvx.unlockCvx(defaultSpendRatio);

      const pirexStakedCvxTokensBefore = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensBeforeStaking = await cvx.balanceOf(pirexCvx.address);
      const stakeEvent = await callAndReturnEvent(pirexCvx.stakeCvx, [
        depositAmount,
      ]);
      const pirexStakedCvxTokensAfter = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(pirexStakedCvxTokensAfter).to.equal(
        pirexStakedCvxTokensBefore.add(unlockable)
      );
      expect(stakeEvent.eventSignature).to.equal("Staked(uint256)");
      expect(stakeEvent.args.amount).to.equal(pirexCvxTokensBeforeStaking);
    });
  });

  describe("unstake", () => {
    it("Should revert if amount to unstake is 0", async () => {
      await expect(pirexCvx.unstakeCvx(0)).to.be.revertedWith("Invalid amount");
    });

    it("Should unstake a specified amount of staked CVX", async () => {
      const pirexStakedCvxTokensBeforeUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensBeforeUnstaking = await cvx.balanceOf(
        pirexCvx.address
      );

      // Transfer half in order to test unstaking only the specified amount
      const unstakeAmount = (
        await cvxRewardPool.balanceOf(pirexCvx.address)
      ).div(2);
      const unstakeEvent = await callAndReturnEvent(pirexCvx.unstakeCvx, [
        unstakeAmount,
      ]);
      const pirexCvxTokensAfterUnstaking = await cvx.balanceOf(
        pirexCvx.address
      );
      const pirexStakedCvxTokensAfterUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(unstakeAmount.gt(0)).to.equal(true);
      expect(pirexStakedCvxTokensAfterUnstaking).to.equal(
        pirexStakedCvxTokensBeforeUnstaking.sub(unstakeAmount)
      );
      expect(pirexCvxTokensAfterUnstaking).to.equal(
        pirexCvxTokensBeforeUnstaking.add(unstakeAmount)
      );
      expect(unstakeEvent.eventSignature).to.equal("Unstaked(uint256)");
      expect(unstakeEvent.args.amount).to.equal(unstakeAmount);
    });
  });

  describe("claimVotiumReward", () => {
    it("Should enable claim by admin", async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);
      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(pirexCvx.address);

      const pirexRewardTokensBeforeClaim = await rewardToken.balanceOf(
        pirexCvx.address
      );

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const claimEvent = await callAndReturnEvent(pirexCvx.claimVotiumReward, [
        rewardToken.address,
        claimIndex,
        amount,
        proof,
        firstDepositEpoch,
      ]);

      const pirexRewardTokensAfterClaim = await rewardToken.balanceOf(
        pirexCvx.address
      );
      const epochReward = await pirexCvx.voteEpochRewards(firstDepositEpoch, 0);
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstDepositEpoch,
        claimEvent.args.voteEpochRewardsIndex
      );

      expect(pirexRewardTokensAfterClaim).to.eq(
        pirexRewardTokensBeforeClaim.add(amount)
      );
      expect(claimEvent.eventSignature).to.equal(
        "VotiumRewardClaimed(address,uint256,uint256,bytes32[],uint256,uint256,address,address,uint256)"
      );
      expect(claimEvent.args.token).to.equal(rewardToken.address);
      expect(claimEvent.args.amount).to.equal(amount);
      expect(claimEvent.args.index).to.equal(claimIndex);
      expect(claimEvent.args.voteEpoch).to.equal(firstDepositEpoch);
      expect(claimEvent.args.managerToken).to.equal(zeroAddress);
      expect(claimEvent.args.managerTokenAmount).to.equal(0);
      expect(epochReward.token).to.equal(rewardToken.address);
      expect(epochReward.amount).to.equal(amount);
      expect(voteEpochRewards.token).to.equal(claimEvent.args.token);
      expect(voteEpochRewards.amount).to.equal(claimEvent.args.amount);
    });

    it("Should revert if the parameters are invalid", async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);
      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(pirexCvx.address);

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const invalidEpoch = 0;
      const futureEpoch = (await pirexCvx.getCurrentEpoch()).add(
        await pirexCvx.epochDepositDuration()
      );
      const validEpoch = firstDepositEpoch;
      const invalidToken = zeroAddress;
      const invalidIndex = claimIndex + 1;
      const invalidAmount = amount.mul(2);

      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          amount,
          proof,
          0
        )
      ).to.be.revertedWith("Invalid voteEpoch");
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          amount,
          proof,
          futureEpoch
        )
      ).to.be.revertedWith("voteEpoch must be previous epoch");
      await expect(
        pirexCvx.claimVotiumReward(
          invalidToken,
          claimIndex,
          amount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith("frozen");
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          invalidIndex,
          amount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith("Invalid proof.");
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          invalidAmount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith("Invalid proof.");
    });

    it("Should allow a VotiumRewardManager contract to swap its reward tokens for CVX", async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);

      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(votiumRewardManager.address);
      await cvx.mint(votiumRewardManager.address, amount);

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const pirexCvxTokensBeforeClaim = await cvx.balanceOf(pirexCvx.address);
      const claimEvent = await callAndReturnEvent(pirexCvx.claimVotiumReward, [
        rewardToken.address,
        claimIndex,
        amount,
        proof,
        firstDepositEpoch,
      ]);
      const pirexCvxTokensAfterClaim = await cvx.balanceOf(pirexCvx.address);
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstDepositEpoch,
        claimEvent.args.voteEpochRewardsIndex
      );

      expect(pirexCvxTokensAfterClaim).to.equal(
        pirexCvxTokensBeforeClaim.add(claimEvent.args.managerTokenAmount)
      );
      expect(claimEvent.args.token).to.not.equal(claimEvent.args.managerToken);
      expect(claimEvent.args.manager).to.equal(votiumRewardManager.address);
      expect(claimEvent.args.managerToken).to.equal(cvx.address);
      expect(claimEvent.args.managerToken).to.equal(voteEpochRewards.token);
      expect(claimEvent.args.managerTokenAmount).to.equal(amount);
    });
  });
});
