import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { toBN } from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
  CvxRewardPool,
  AddressRegistry,
} from '../typechain-types';

let admin: SignerWithAddress;
let notAdmin: SignerWithAddress;
let treasury: SignerWithAddress;
let revenueLockers: SignerWithAddress;
let contributors: SignerWithAddress;
let pCvx: PirexCvx;
let pirexFees: PirexFees;
let cvx: ConvexToken;
let crv: Crv;
let cvxCrvToken: any;
let cvxLocker: CvxLocker;
let cvxDelegateRegistry: DelegateRegistry;
let cvxRewardPool: CvxRewardPool;
let votiumAddressRegistry: AddressRegistry;
let votiumMultiMerkleStash: MultiMerkleStash;

before(async function () {
  [admin, notAdmin, treasury, revenueLockers, contributors] =
    await ethers.getSigners();

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
  cvx = await (
    await ethers.getContractFactory('ConvexToken')
  ).deploy(curveVoterProxy.address);
  crv = await (await ethers.getContractFactory('Crv')).deploy();
  cvxCrvToken = await (await ethers.getContractFactory('cvxCrvToken')).deploy();
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
  cvxLocker = await (
    await ethers.getContractFactory('CvxLocker')
  ).deploy(cvx.address, cvxCrvToken.address, baseRewardPool.address);
  cvxRewardPool = await (
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
  votiumMultiMerkleStash = await v.deploy();

  votiumAddressRegistry = await (
    await ethers.getContractFactory('AddressRegistry')
  ).deploy();
  cvxDelegateRegistry = await (
    await ethers.getContractFactory('DelegateRegistry')
  ).deploy();

  // Configurations
  await cvxLocker.setStakingContract(cvxStakingProxy.address);
  await cvxLocker.setApprovals();
  await cvxLocker.addReward(crv.address, admin.address, true);
  await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
  await cvxStakingProxy.setApprovals();
  await cvx.mint(admin.address, initialBalanceForAdmin);
  await crv.mint(admin.address, initialBalanceForAdmin);
  await cvxCrvToken.mint(admin.address, initialBalanceForAdmin);

  pirexFees = await (
    await ethers.getContractFactory('PirexFees')
  ).deploy(treasury.address, revenueLockers.address, contributors.address);
  pCvx = await (
    await ethers.getContractFactory('PirexCvx')
  ).deploy(
    cvx.address,
    cvxLocker.address,
    cvxDelegateRegistry.address,
    cvxRewardPool.address,
    cvxCrvToken.address,
    pirexFees.address,
    votiumMultiMerkleStash.address
  );

  this.admin = admin;
  this.notAdmin = notAdmin;
  this.treasury = treasury;
  this.revenueLockers = revenueLockers;
  this.contributors = contributors;
  this.cvx = cvx;
  this.crv = crv;
  this.cvxCrvToken = cvxCrvToken;
  this.cvxLocker = cvxLocker;
  this.cvxRewardPool = cvxRewardPool;
  this.cvxDelegateRegistry = cvxDelegateRegistry;
  this.votiumAddressRegistry = votiumAddressRegistry;
  this.votiumMultiMerkleStash = votiumMultiMerkleStash;
  this.pirexFees = pirexFees;
  this.pCvx = pCvx;

  await this.pirexFees.grantFeeDistributorRole(pCvx.address);

  this.feePercentDenominator = await pirexFees.PERCENT_DENOMINATOR();
  this.feeDenominator = await pCvx.FEE_DENOMINATOR();
});
