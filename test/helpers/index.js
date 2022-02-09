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

// This method prevents the overflow error when calling toNumber() directly on large #s
const convertBigNumberToNumber = (bigNumber) => Number(bigNumber.toString());

module.exports = {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
};
