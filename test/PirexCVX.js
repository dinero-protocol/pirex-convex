const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PirexCVX", () => {
  let pirexCvx;
  const cvxLocker = "0xD18140b4B819b895A3dba5442F959fA44994AF50";

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    pirexCvx = await (
      await ethers.getContractFactory("PirexCVX")
    ).deploy(cvxLocker);
  });

  describe("constructor", () => {
    it("Should set up contract state", async () => {
      const owner = await pirexCvx.owner();
      const _cvxLocker = await pirexCvx.cvxLocker();

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker);
    });
  });
});
