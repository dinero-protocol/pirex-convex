import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { setUpConvex } from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
  CvxRewardPool,
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
let votiumMultiMerkleStash: MultiMerkleStash;

before(async function () {
  [admin, notAdmin, treasury, revenueLockers, contributors] =
    await ethers.getSigners();
  ({
    cvx,
    crv,
    cvxCrvToken,
    cvxLocker,
    cvxRewardPool,
    cvxDelegateRegistry,
    votiumMultiMerkleStash,
  } = await setUpConvex());
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
  this.votiumMultiMerkleStash = votiumMultiMerkleStash;
  this.pirexFees = pirexFees;
  this.pCvx = pCvx;

  await this.pirexFees.grantFeeDistributorRole(pCvx.address);

  this.feePercentDenominator = await pirexFees.PERCENT_DENOMINATOR();
  this.feeDenominator = await pCvx.FEE_DENOMINATOR();
});
