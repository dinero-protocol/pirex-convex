const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
  let cvx;
  let cvxLocker;
  let pirexCvx;
  const initialCvxBalanceForAdmin = ethers.BigNumber.from(`${10e18}`);

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    cvx = await (
      await ethers.getContractFactory("Cvx")
    ).deploy();

    cvxLocker = await (
      await ethers.getContractFactory("CvxLocker")
    ).deploy(cvx.address);

    pirexCvx = await (
      await ethers.getContractFactory("PirexCVX")
    ).deploy(cvxLocker.address, cvx.address);

    await cvxLocker.setStakingContract('0xe096ccec4a1d36f191189fe61e803d8b2044dfc3');
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
});
