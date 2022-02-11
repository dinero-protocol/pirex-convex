import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Promise } from "bluebird";
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
} from "./helpers";
import { BigNumber } from "ethers";
import { Cvx, CvxLocker, CvxRewardPool, PirexCvx } from "../typechain-types";

describe("PirexCvx", () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let cvx: Cvx;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;
  let firstDepositEpoch: BigNumber;
  let secondDepositEpoch: BigNumber;

  const crvAddr = "0xd533a949740bb3306d119cc777fa900ba034cd52";
  const crvDepositorAddr = "0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae";
  const cvxCrvRewardsAddr = "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e";
  const cvxCrvTokenAddr = "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7";
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;
  const lockedCvxPrefix = "lockedCVX";

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const CVX = await ethers.getContractFactory("Cvx");
    const CVXLocker = await ethers.getContractFactory("CvxLocker");
    const CVXRewardPool = await ethers.getContractFactory("CvxRewardPool");
    const PirexCVX = await ethers.getContractFactory("PirexCvx");

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
      initialEpochDepositDuration,
      cvxLockerLockDuration
    );

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
      const _epochDepositDuration = await pirexCvx.epochDepositDuration();
      const _lockDuration = await pirexCvx.lockDuration();
      const erc20Implementation = await pirexCvx.erc20Implementation();

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
      expect(_epochDepositDuration).to.equal(initialEpochDepositDuration);
      expect(_lockDuration).to.equal(cvxLockerLockDuration);
      expect(erc20Implementation).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
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
      expect(depositEvent.args.token).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
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
});
