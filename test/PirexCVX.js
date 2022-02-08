const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
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
  const initialCvxBalanceForAdmin = ethers.BigNumber.from(`${10e18}`);
  const epochDepositDuration = 1209600; // 2 weeks in seconds

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
      await ethers.getContractFactory("PirexCVX")
    ).deploy(
      cvxLocker.address,
      cvx.address,
      cvxRewardPool.address,
      epochDepositDuration,
      cvxLockerLockDuration
    );
    await cvxLocker.setStakingContract(
      "0xe096ccec4a1d36f191189fe61e803d8b2044dfc3"
    );
    await cvxLocker.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

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
      expect(_epochDepositDuration).to.equal(epochDepositDuration);
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
      const cvxBalanceBeforeDeposit = await cvx.balanceOf(admin.address);
      const vlCvxBalanceBeforeDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );
      const depositAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;

      await cvx.approve(pirexCvx.address, depositAmount);

      const { events } = await (
        await pirexCvx.deposit(depositAmount, spendRatio)
      ).wait();
      const depositEvent = events[events.length - 1];
      const rewardsDuration = Number(
        (await cvxLocker.rewardsDuration()).toString()
      );

      // Fast forward 1 rewards duration so that balance is reflected
      await ethers.provider.send("evm_increaseTime", [rewardsDuration]);
      await network.provider.send("evm_mine");

      const cvxBalanceAfterDeposit = await cvx.balanceOf(admin.address);
      const vlCvxBalanceAfterDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      // Store to conveniently withdraw tokens for a specific epoch later
      firstDepositEpoch = currentEpoch;

      const depositToken = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        depositEvent.args.token
      );
      const pirexVlCVXBalance = await depositToken.balanceOf(admin.address);

      expect(cvxBalanceAfterDeposit).to.equal(
        cvxBalanceBeforeDeposit.sub(depositAmount)
      );
      expect(vlCvxBalanceAfterDeposit).to.equal(
        vlCvxBalanceBeforeDeposit.add(depositAmount)
      );
      expect(depositEvent.eventSignature).to.equal(
        "Deposited(uint256,uint256,uint256,uint256,address)"
      );
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(spendRatio);
      expect(depositEvent.args.epoch).to.equal(currentEpoch);
      expect(depositEvent.args.lockExpiry).to.not.equal(0);
      expect(depositEvent.args.token).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(pirexVlCVXBalance).to.equal(depositAmount);
    });

    it("Should mint the correct number of vlCVX tokens on subsequent deposits", async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const { token } = await pirexCvx.deposits(currentEpoch);
      const depositToken = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        token
      );
      const pirexVlCVXBalanceBefore = await depositToken.balanceOf(
        admin.address
      );
      const depositAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;

      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, spendRatio);

      const pirexVlCVXBalanceAfter = await depositToken.balanceOf(
        admin.address
      );

      expect(pirexVlCVXBalanceAfter).to.equal(
        pirexVlCVXBalanceBefore.add(depositAmount)
      );
    });

    it("Should mint a new token for a new epoch", async () => {
      const epochDepositDuration = Number(
        (await pirexCvx.epochDepositDuration()).toString()
      );
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const { token: currentEpochToken } = await pirexCvx.deposits(
        currentEpoch
      );
      const depositTokenForCurrentEpoch = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        currentEpochToken
      );
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const depositAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;

      // Store to conveniently withdraw tokens for a specific epoch later
      secondDepositEpoch = nextEpoch;

      // Fast forward 1 epoch
      await ethers.provider.send("evm_increaseTime", [epochDepositDuration]);
      await network.provider.send("evm_mine");
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, spendRatio);

      const { token: nextEpochToken } = await pirexCvx.deposits(nextEpoch);
      const depositTokenForNextEpoch = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        nextEpochToken
      );

      expect(await depositTokenForCurrentEpoch.name()).to.equal(
        `vlCVX-${currentEpoch}`
      );
      expect(await depositTokenForNextEpoch.name()).to.equal(
        `vlCVX-${nextEpoch}`
      );
      expect(await depositTokenForNextEpoch.balanceOf(admin.address)).to.equal(
        depositAmount
      );
    });
  });

  describe("withdraw", () => {
    it("Should revert if withdrawing CVX before lock expiry", async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const spendRatio = 0;

      await expect(
        pirexCvx.withdraw(currentEpoch, spendRatio)
      ).to.be.revertedWith("Cannot withdraw before lock expiry");
    });

    it("Should withdraw CVX if after lock expiry (first epoch deposit)", async () => {
      const epochDepositDuration = Number(
        (await pirexCvx.epochDepositDuration()).toString()
      );
      const lockDuration = Number((await pirexCvx.lockDuration()).toString());
      const { token, lockExpiry } = await pirexCvx.deposits(firstDepositEpoch);
      const depositToken = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        token
      );
      const spendRatio = 0;

      // Fast forward to after lock expiry
      await ethers.provider.send("evm_increaseTime", [
        epochDepositDuration + lockDuration,
      ]);
      await network.provider.send("evm_mine");

      const depositTokenBalanceBeforeWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceBeforeWithdraw = await cvx.balanceOf(admin.address);
      const timestampAfterIncrease = ethers.BigNumber.from(
        `${(await ethers.provider.getBlock()).timestamp}`
      );

      await depositToken.approve(
        pirexCvx.address,
        depositTokenBalanceBeforeWithdraw
      );

      const { events } = await (
        await pirexCvx.withdraw(firstDepositEpoch, spendRatio)
      ).wait();
      const withdrawEvent = events[events.length - 1];
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
      expect(withdrawEvent.args.spendRatio).to.equal(spendRatio);
      expect(withdrawEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(withdrawEvent.args.lockExpiry).to.not.equal(0);
      expect(withdrawEvent.args.token).to.equal(depositToken.address);
    });

    it("Should withdraw CVX if after lock expiry (second epoch deposit)", async () => {
      const { token } = await pirexCvx.deposits(secondDepositEpoch);
      const depositToken = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        token
      );
      const spendRatio = 0;
      const depositTokenBalanceBeforeWithdraw = await depositToken.balanceOf(
        admin.address
      );
      const cvxBalanceBeforeWithdraw = await cvx.balanceOf(admin.address);

      await depositToken.approve(
        pirexCvx.address,
        depositTokenBalanceBeforeWithdraw
      );
      await pirexCvx.withdraw(secondDepositEpoch, spendRatio);

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
      const depositAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;
      const lockDuration = Number((await pirexCvx.lockDuration()).toString());

      await cvx.approve(pirexCvx.address, depositAmount);

      await pirexCvx.deposit(depositAmount, spendRatio);

      const { timestamp } = await ethers.provider.getBlock();

      // Fast forward to after lock expiry
      await ethers.provider.send("evm_increaseTime", [
        timestamp + lockDuration,
      ]);
      await network.provider.send("evm_mine");

      const { unlockable } = await cvxLocker.lockedBalances(pirexCvx.address);

      await pirexCvx.unlockCvx(spendRatio);

      const stakedCvxBalanceBefore = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const cvxBalanceBeforeStaking = await cvx.balanceOf(pirexCvx.address);

      const { events } = await (await pirexCvx.stakeCvx()).wait();
      const stakeEvent = events[events.length - 1];

      const stakedCvxBalanceAfter = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(stakedCvxBalanceAfter).to.equal(
        stakedCvxBalanceBefore.add(unlockable)
      );
      expect(stakeEvent.eventSignature).to.equal('Staked(uint256)');
      expect(stakeEvent.args.amount).to.equal(cvxBalanceBeforeStaking);
    });
  });
});
