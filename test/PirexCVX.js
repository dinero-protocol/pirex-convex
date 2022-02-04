const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
  let cvx;
  let cvxLocker;
  let pirexCvx;
  const initialCvxBalanceForAdmin = ethers.BigNumber.from(`${10e18}`);
  const epochDepositDuration = 1209600; // 2 weeks in seconds
  let cvxLockerLockDuration;

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    cvx = await (await ethers.getContractFactory("Cvx")).deploy();

    cvxLocker = await (
      await ethers.getContractFactory("CvxLocker")
    ).deploy(cvx.address);

    cvxLockerLockDuration = await cvxLocker.lockDuration();

    pirexCvx = await (
      await ethers.getContractFactory("PirexCVX")
    ).deploy(
      cvxLocker.address,
      cvx.address,
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

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
      expect(_epochDepositDuration).to.equal(epochDepositDuration);
      expect(_lockDuration).to.equal(cvxLockerLockDuration);
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
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const currentEpoch = ethers.BigNumber.from(
        `${
          Math.floor(
            (await ethers.provider.getBlock()).timestamp / epochDepositDuration
          ) * epochDepositDuration
        }`
      );
      const { amount: totalAmount, lockExpiry } = await pirexCvx.deposits(
        currentEpoch
      );
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
        "Deposited(uint256,uint256,uint256,uint256,uint256,address)"
      );
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(spendRatio);
      expect(depositEvent.args.currentEpoch).to.equal(currentEpoch);
      expect(depositEvent.args.totalAmount).to.equal(totalAmount);
      expect(depositEvent.args.lockExpiry).to.equal(lockExpiry);
      expect(depositEvent.args.token).to.not.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(pirexVlCVXBalance).to.equal(depositAmount);
    });

    it("Should not mint double vlCVX tokens for users", async () => {
      const { timestamp } = await ethers.provider.getBlock();
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const currentEpoch =
        Math.floor(timestamp / epochDepositDuration) * epochDepositDuration;
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
      const { timestamp } = await ethers.provider.getBlock();
      const epochDepositDuration = Number(
        (await pirexCvx.epochDepositDuration()).toString()
      );
      const currentEpoch =
        Math.floor(timestamp / epochDepositDuration) * epochDepositDuration;
      const { token: currentEpochToken } = await pirexCvx.deposits(
        currentEpoch
      );
      const depositTokenForCurrentEpoch = await ethers.getContractAt(
        "ERC20PresetMinterPauserUpgradeable",
        currentEpochToken
      );
      const nextEpoch =
        Math.floor((timestamp + epochDepositDuration) / epochDepositDuration) *
        epochDepositDuration;
      const depositAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;

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
});
