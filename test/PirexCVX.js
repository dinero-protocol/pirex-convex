const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
  let cvx;
  let cvxLocker;
  let pirexCvx;
  const initialCvxBalanceForAdmin = ethers.BigNumber.from(`${10e18}`);

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    cvx = await (await ethers.getContractFactory("Cvx")).deploy();

    cvxLocker = await (
      await ethers.getContractFactory("CvxLocker")
    ).deploy(cvx.address);

    pirexCvx = await (
      await ethers.getContractFactory("PirexCVX")
    ).deploy(cvxLocker.address, cvx.address);

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

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
    });
  });

  describe("deposit", () => {
    it("Should deposit CVX", async () => {
      const cvxBalanceBeforeDeposit = await cvx.balanceOf(admin.address);
      const vlCvxBalanceBeforeDeposit = await cvxLocker.balanceOf(
        admin.address
      );
      const lockAmount = ethers.BigNumber.from(`${1e18}`);
      const spendRatio = 0;

      await cvx.approve(pirexCvx.address, lockAmount);

      const { events } = await (
        await pirexCvx.lock(admin.address, lockAmount, spendRatio)
      ).wait();
      const lockEvent = events[events.length - 1];
      const rewardsDuration = Number(
        (await cvxLocker.rewardsDuration()).toString()
      );

      // Fast forward 1 rewards duration so that balance is reflected
      await ethers.provider.send("evm_increaseTime", [rewardsDuration]);
      await network.provider.send("evm_mine");

      const cvxBalanceAfterDeposit = await cvx.balanceOf(admin.address);
      const vlCvxBalanceAfterDeposit = await cvxLocker.balanceOf(admin.address);

      expect(cvxBalanceAfterDeposit).to.equal(
        cvxBalanceBeforeDeposit.sub(lockAmount)
      );
      expect(vlCvxBalanceAfterDeposit).to.equal(
        vlCvxBalanceBeforeDeposit.add(lockAmount)
      );
      expect(lockEvent.eventSignature).to.equal(
        "Lock(address,uint256,uint256)"
      );
      expect(lockEvent.args.account).to.equal(admin.address);
      expect(lockEvent.args.amount).to.equal(lockAmount);
      expect(lockEvent.args.spendRatio).to.equal(spendRatio);
    });
  });
});
