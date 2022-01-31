const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SSOVWrapperEth", () => {
  let ssov;
  let admin;
  let notAdmin;

  const dopexSsovEth = "0x2c9C1E9b4BDf6Bf9CB59C77e0e8C0892cE3A9d5f";

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    ssov = await (
      await ethers.getContractFactory("SSOVWrapperEth")
    ).deploy(dopexSsovEth);
  });

  describe("setDopexSsovEth", () => {
    it("Should set dopexSsovEth", async () => {
      const dopexSsovEthBefore = await ssov.dopexSsovEth();

      await ssov.setDopexSsovEth(admin.address);

      const dopexSsovEthAfter = await ssov.dopexSsovEth();

      expect(dopexSsovEthBefore).to.equal(dopexSsovEth);
      expect(dopexSsovEthAfter).to.equal(admin.address);

      // Set back to correct address
      await ssov.setDopexSsovEth(dopexSsovEth);
    });

    it("Should revert if not owner", async () => {
      await expect(
        ssov.connect(notAdmin).setDopexSsovEth(notAdmin.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("configureEpochStrike", () => {
    it("Should set token for an epoch-strike", async () => {
      const tokenBefore = (await ssov.getEpochStrike(0, 0)).token;
      const [events] = (
        await (
          await ssov.configureEpochStrike(0, 0, admin.address, false)
        ).wait()
      ).events;

      expect(tokenBefore).to.equal(
        "0x0000000000000000000000000000000000000000"
      );
      expect(events.args.token).to.equal(admin.address);
    });

    it("Should set withdrawable for an epoch-strike", async () => {
      const withdrawableBefore = (await ssov.getEpochStrike(0, 0)).withdrawable;
      const [events] = (
        await (
          await ssov.configureEpochStrike(
            0,
            0,
            "0x0000000000000000000000000000000000000000",
            true
          )
        ).wait()
      ).events;

      expect(withdrawableBefore).to.equal(false);
      expect(events.args.withdrawable).to.equal(true);
    });

    it("Should revert if not owner", async () => {
      await expect(
        ssov
          .connect(notAdmin)
          .configureEpochStrike(
            0,
            0,
            "0x0000000000000000000000000000000000000000",
            false
          )
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("getEpochStrike", () => {
    it("Should get the correct epoch-strike", async () => {
      const epochStrikeBefore = await ssov.getEpochStrike(1, 1);

      await ssov.configureEpochStrike(1, 1, admin.address, true);

      const epochStrikeAfter = await ssov.getEpochStrike(1, 1);

      expect(epochStrikeBefore.token).to.equal("0x0000000000000000000000000000000000000000");
      expect(epochStrikeBefore.withdrawable).to.equal(false);
      expect(epochStrikeAfter.token).to.equal(admin.address);
      expect(epochStrikeAfter.withdrawable).to.equal(true);
    });
  });
});
