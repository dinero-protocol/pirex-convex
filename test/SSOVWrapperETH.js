const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SSOVWrapperEth", () => {
  let ssov;
  let admin;
  let notAdmin;

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    ssov = await (await ethers.getContractFactory("SSOVWrapperEth")).deploy();
  });

  describe("ConfigureEpochStrike", () => {
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
});
