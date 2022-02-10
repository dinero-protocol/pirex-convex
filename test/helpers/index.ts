import { BigNumber } from "ethers";
import { ethers } from "hardhat";

export async function callAndReturnEvent(fn: any, fnArgs: any): Promise<any> {
  const { events } = await (await fn.apply(null, fnArgs)).wait();

  return events[events.length - 1];
};

export async function increaseBlockTimestamp(time: number) {
  // Fast forward 1 rewards duration so that balance is reflected
  await ethers.provider.send("evm_increaseTime", [time]);
  await ethers.provider.send("evm_mine", []);
};

// This method prevents the overflow error when calling toNumber() directly on large #s
export function convertBigNumberToNumber(bigNumber: BigNumber): number {
  return Number(bigNumber.toString());
}

export function toBN(num: number): BigNumber {
  return ethers.BigNumber.from(`${num}`);
}
