const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
} = require("./helpers");

describe("PirexCvx", () => {
  let cvx;
  let cvxLocker;
  let cvxRewardPool;
  let pirexCvx;
  let cvxLockerLockDuration;
  let firstDepositEpoch;
  let secondDepositEpoch;

  const crvAddr = "0xd533a949740bb3306d119cc777fa900ba034cd52";
  const crvDepositorAddr = "0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae";
  const cvxCrvRewardsAddr = "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e";
  const cvxCrvTokenAddr = "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7";
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    cvx = await (await ethers.getContractFactory("Cvx")).deploy();
    cvxLocker = await (
      await ethers.getContractFactory("CvxLocker")
    ).deploy(cvx.address);
    cvxRewardPool = await (
      await ethers.getContractFactory("cvxRewardPool")
    ).deploy(
      cvx.address,
      crvAddr,
      crvDepositorAddr,
      cvxCrvRewardsAddr,
      cvxCrvTokenAddr,
      admin.address,
      admin.address
    );
    cvxLockerLockDuration = await cvxLocker.lockDuration();
    pirexCvx = await (
      await ethers.getContractFactory("PirexCvx")
    ).deploy(
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

  const getDepositToken = async (address) =>
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
      const { timestamp } = await ethers.provider.getBlock();
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      expect(currentEpoch).to.equal(
        Math.floor(timestamp / epochDepositDuration) * epochDepositDuration
      );
    });
  });

  describe("deposit", () => {
    it("Should deposit CVX", async () => {
      const userCvxBeforeDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxBeforeDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);

      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);
      const rewardsDuration = convertBigNumberToNumber(
        await cvxLocker.rewardsDuration()
      );

      // Convex does not reflect actual locked CVX until their next epoch (1 week)
      await increaseBlockTimestamp(rewardsDuration);

      const userCvxAfterDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxAfterDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );

      // Store to test withdrawing tokens for this specific epoch later
      firstDepositEpoch = await pirexCvx.getCurrentEpoch();

      const depositToken = await getDepositToken(depositEvent.args.token);
      const userPirexCvx = await depositToken.balanceOf(admin.address);
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const lockDuration = await pirexCvx.lockDuration();

      expect(userCvxAfterDeposit).to.equal(
        userCvxBeforeDeposit.sub(depositAmount)
      );
      expect(pirexLockedCvxAfterDeposit).to.equal(
        pirexLockedCvxBeforeDeposit.add(depositAmount)
      );
      expect(depositEvent.eventSignature).to.equal(
        "Deposited(uint256,uint256,uint256,uint256,address)"
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
      expect(userPirexCvx).to.equal(depositAmount);
    });

    it("Should mint the correct amount of user tokens on subsequent deposits", async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const { token, lockExpiry } = await pirexCvx.deposits(currentEpoch);
      const depositToken = await getDepositToken(token);
      const userPirexCvxBeforeDeposit = await depositToken.balanceOf(
        admin.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);
      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);

      const userPirexCvxAfterDeposit = await depositToken.balanceOf(
        admin.address
      );
      const { token: tokenAfterDeposit, lockExpiry: lockExpiryAfterDeposit } =
        await pirexCvx.deposits(currentEpoch);

      expect(userPirexCvxAfterDeposit).to.equal(
        userPirexCvxBeforeDeposit.add(depositAmount)
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
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const { token: currentEpochToken } = await pirexCvx.deposits(
        currentEpoch
      );
      const depositTokenForCurrentEpoch = await getDepositToken(
        currentEpochToken
      );
      const depositTokenForCurrentEpochName =
        await depositTokenForCurrentEpoch.name();
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const depositAmount = toBN(1e18);

      // Store to conveniently withdraw tokens for a specific epoch later
      secondDepositEpoch = nextEpoch;

      // Fast forward 1 epoch
      await increaseBlockTimestamp(epochDepositDuration);
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      const { token: nextEpochToken } = await pirexCvx.deposits(nextEpoch);
      const depositTokenForNextEpoch = await getDepositToken(nextEpochToken);
      const depositTokenForNextEpochName =
        await depositTokenForNextEpoch.name();
      const userPirexCvxForNextEpoch = await depositTokenForNextEpoch.balanceOf(
        admin.address
      );

      expect(depositTokenForCurrentEpochName).to.equal(`vlCVX-${currentEpoch}`);
      expect(depositTokenForNextEpochName).to.equal(`vlCVX-${nextEpoch}`);
      expect(depositTokenForCurrentEpoch.address).to.not.equal(
        depositTokenForNextEpoch.address
      );
      expect(userPirexCvxForNextEpoch).to.equal(depositAmount);
    });
  });

  describe("withdraw", () => {
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
      const { token, lockExpiry } = await pirexCvx.deposits(firstDepositEpoch);
      const depositToken = await getDepositToken(token);

      // Fast forward to after lock expiry
      await increaseBlockTimestamp(epochDepositDuration + lockDuration);

      const depositTokenBalanceBeforeWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceBeforeWithdraw = await cvx.balanceOf(admin.address);
      const timestampAfterIncrease = toBN(
        (await ethers.provider.getBlock()).timestamp
      );

      await depositToken.approve(
        pirexCvx.address,
        depositTokenBalanceBeforeWithdraw
      );

      const withdrawEvent = await callAndReturnEvent(pirexCvx.withdraw, [
        firstDepositEpoch,
        defaultSpendRatio,
      ]);
      const depositTokenBalanceAfterWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceAfterWithdraw = await cvx.balanceOf(admin.address);

      expect(timestampAfterIncrease.gte(lockExpiry)).to.equal(true);
      expect(depositTokenBalanceAfterWithdraw).to.equal(0);
      expect(cvxBalanceAfterWithdraw).to.equal(
        cvxBalanceBeforeWithdraw.add(depositTokenBalanceBeforeWithdraw)
      );
      expect(withdrawEvent.eventSignature).to.equal(
        "Withdrew(uint256,uint256,uint256,uint256,address)"
      );
      expect(withdrawEvent.args.amount).to.equal(
        depositTokenBalanceBeforeWithdraw
      );
      expect(withdrawEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(withdrawEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(withdrawEvent.args.lockExpiry).to.not.equal(0);
      expect(withdrawEvent.args.token).to.equal(depositToken.address);
    });

    it("Should withdraw CVX if after lock expiry (second epoch deposit)", async () => {
      const { token } = await pirexCvx.deposits(secondDepositEpoch);
      const depositToken = await getDepositToken(token);
      const depositTokenBalanceBeforeWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceBeforeWithdraw = await cvx.balanceOf(admin.address);

      await depositToken.approve(
        pirexCvx.address,
        depositTokenBalanceBeforeWithdraw
      );
      await pirexCvx.withdraw(secondDepositEpoch, defaultSpendRatio);

      const depositTokenBalanceAfterWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceAfterWithdraw = await cvx.balanceOf(admin.address);

      expect(depositTokenBalanceAfterWithdraw).to.equal(0);
      expect(cvxBalanceAfterWithdraw).to.equal(
        cvxBalanceBeforeWithdraw.add(depositTokenBalanceBeforeWithdraw)
      );
    });
  });

  describe("stake", () => {
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

      const stakedCvxBalanceBefore = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const cvxBalanceBeforeStaking = await cvx.balanceOf(pirexCvx.address);
      const stakeEvent = await callAndReturnEvent(pirexCvx.stakeCvx, []);
      const stakedCvxBalanceAfter = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(stakedCvxBalanceAfter).to.equal(
        stakedCvxBalanceBefore.add(unlockable)
      );
      expect(stakeEvent.eventSignature).to.equal("Staked(uint256)");
      expect(stakeEvent.args.amount).to.equal(cvxBalanceBeforeStaking);
    });
  });

  describe("unstake", () => {
    it("Should unstake a specified amount of staked CVX", async () => {
      const stakedCvxBalanceBeforeUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const cvxBalanceBeforeUnstaking = await cvx.balanceOf(pirexCvx.address);
      const unstakeAmount = (
        await cvxRewardPool.balanceOf(pirexCvx.address)
      ).div(2);
      const unstakeEvent = await callAndReturnEvent(pirexCvx.unstakeCvx, [
        unstakeAmount,
      ]);
      const cvxBalanceAfterUnstaking = await cvx.balanceOf(pirexCvx.address);
      const stakedCvxBalanceAfterUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(unstakeAmount.gt(0)).to.equal(true);
      expect(stakedCvxBalanceAfterUnstaking).to.equal(
        stakedCvxBalanceBeforeUnstaking.sub(unstakeAmount)
      );
      expect(cvxBalanceAfterUnstaking).to.equal(
        cvxBalanceBeforeUnstaking.add(unstakeAmount)
      );
      expect(unstakeEvent.eventSignature).to.equal("Unstaked(uint256)");
      expect(unstakeEvent.args.amount).to.equal(unstakeAmount);
    });
  });
});
