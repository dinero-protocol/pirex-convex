import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';

export const callAndReturnEvent = async (
  fn: any,
  fnArgs: any[]
): Promise<any> => {
  const { events } = await (await fn(...fnArgs)).wait();

  return events[events.length - 1];
};

export async function callAndReturnEvents(fn: any, fnArgs: any): Promise<any> {
  const { events } = await (await fn(...fnArgs)).wait();

  return events;
}

export async function increaseBlockTimestamp(time: number) {
  // Fast forward 1 rewards duration so that balance is reflected
  await ethers.provider.send('evm_increaseTime', [time]);
  await ethers.provider.send('evm_mine', []);
}

// This method prevents the overflow error when calling toNumber() directly on large #s
export function convertBigNumberToNumber(bigNumber: BigNumber): number {
  return Number(bigNumber.toString());
}

export function toBN(num: number): BigNumber {
  return ethers.BigNumber.from(`${num}`);
}

export const impersonateAddressAndReturnSigner = async (
  networkAdmin: SignerWithAddress,
  address: string
) => {
  await ethers.provider.send('hardhat_impersonateAccount', [address]);
  const account = await ethers.getSigner(address);
  await networkAdmin.sendTransaction({
    to: address,
    value: ethers.utils.parseEther('100'),
  });

  return account;
};

// Min must be 1 or greater
export const getNumberBetweenRange: (min: number, max: number) => number = (
  min: number,
  max: number
) => Math.floor(Math.random() * max) + (min > 0 ? min : 1);

export const setUpConvex = async () => {
  const [admin]: SignerWithAddress[] = await ethers.getSigners();

  // Constants
  const initialBalanceForAdmin = toBN(100e18);
  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';

  // Contracts
  const curveVoterProxy = await (
    await ethers.getContractFactory('CurveVoterProxy')
  ).deploy();
  const cvx = await (
    await ethers.getContractFactory('ConvexToken')
  ).deploy(curveVoterProxy.address);
  const crv = await (await ethers.getContractFactory('Crv')).deploy();
  const cvxCrvToken = await (
    await ethers.getContractFactory('cvxCrvToken')
  ).deploy();
  const booster = await (
    await ethers.getContractFactory('Booster')
  ).deploy(curveVoterProxy.address, cvx.address);
  const rewardFactory = await (
    await ethers.getContractFactory('RewardFactory')
  ).deploy(booster.address);
  const baseRewardPool = await (
    await ethers.getContractFactory(
      'contracts/mocks/BaseRewardPool.sol:BaseRewardPool'
    )
  ).deploy(
    0,
    cvxCrvToken.address,
    crv.address,
    booster.address,
    rewardFactory.address
  );
  const cvxLocker = await (
    await ethers.getContractFactory('CvxLocker')
  ).deploy(cvx.address, cvxCrvToken.address, baseRewardPool.address);
  const cvxRewardPool = await (
    await ethers.getContractFactory('CvxRewardPool')
  ).deploy(
    cvx.address,
    crvAddr,
    crvDepositorAddr,
    cvxCrvRewardsAddr,
    cvxCrvTokenAddr,
    booster.address,
    admin.address
  );
  const cvxStakingProxy = await (
    await ethers.getContractFactory('CvxStakingProxy')
  ).deploy(
    cvxLocker.address,
    cvxRewardPool.address,
    crv.address,
    cvx.address,
    cvxCrvToken.address
  );

  // Workaround for Typescript not acknowledging deploy method
  const v: any = await ethers.getContractFactory('MultiMerkleStash');
  const votiumMultiMerkleStash = await v.deploy();

  const votiumAddressRegistry = await (
    await ethers.getContractFactory('AddressRegistry')
  ).deploy();
  const cvxDelegateRegistry = await (
    await ethers.getContractFactory('DelegateRegistry')
  ).deploy();

  // Configurations
  await cvxLocker.setStakingContract(cvxStakingProxy.address);
  await cvxLocker.setApprovals();
  await cvxLocker.addReward(crv.address, admin.address, true);
  await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
  await cvxStakingProxy.setApprovals();
  await cvx.mint(admin.address, initialBalanceForAdmin);
  await crv.mint(admin.address, initialBalanceForAdmin)

  return {
    curveVoterProxy,
    cvx,
    crv,
    cvxCrvToken,
    booster,
    rewardFactory,
    baseRewardPool,
    cvxLocker,
    cvxStakingProxy,
    votiumMultiMerkleStash,
    votiumAddressRegistry,
    cvxDelegateRegistry,
  };
};
