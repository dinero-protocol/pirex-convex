const { ethers } = require("hardhat");

const callAndReturnEvent = async (fn, fnArgs) => {
  const { events } = await (await fn.apply(null, fnArgs)).wait();

  return events[events.length - 1];
};

const increaseBlockTimestamp = async (time) => {
  // Fast forward 1 rewards duration so that balance is reflected
  await ethers.provider.send("evm_increaseTime", [time]);
  await network.provider.send("evm_mine");
};

module.exports = {
  callAndReturnEvent,
  increaseBlockTimestamp,
};
