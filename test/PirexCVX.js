const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
  let cvx;
  let cvxLocker;
  let pirexCvx;
  const initialCvxBalanceForAdmin = ethers.BigNumber.from(`${10e18}`);
  const depositDuration = 1209600; // 2 weeks in seconds

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    cvx = await (await ethers.getContractFactory("Cvx")).deploy();

    cvxLocker = await (
      await ethers.getContractFactory("CvxLocker")
    ).deploy(cvx.address);

    pirexCvx = await (
      await ethers.getContractFactory("PirexCVX")
    ).deploy(cvxLocker.address, cvx.address, depositDuration);

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
      const _depositDuration = await pirexCvx.depositDuration();

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
      expect(_depositDuration).to.equal(depositDuration);
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
      const depositDuration = await pirexCvx.depositDuration();
      const currentEpoch = ethers.BigNumber.from(
        `${
          Math.floor(
            (await ethers.provider.getBlock()).timestamp / depositDuration
          ) * depositDuration
        }`
      );
      const { amount: totalAmount, lockExpiry } = await pirexCvx.deposits(currentEpoch);

      expect(cvxBalanceAfterDeposit).to.equal(
        cvxBalanceBeforeDeposit.sub(depositAmount)
      );
      expect(vlCvxBalanceAfterDeposit).to.equal(
        vlCvxBalanceBeforeDeposit.add(depositAmount)
      );
      expect(depositEvent.eventSignature).to.equal(
        "Deposited(uint256,uint256,uint256,uint256,uint256)"
      );
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(spendRatio);
      expect(depositEvent.args.currentEpoch).to.equal(currentEpoch);
      expect(depositEvent.args.totalAmount).to.equal(totalAmount);
      expect(depositEvent.args.lockExpiry).to.equal(lockExpiry);
    });
  });
});
