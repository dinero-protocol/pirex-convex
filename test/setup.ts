import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { toBN } from './helpers';
import { Promise } from 'bluebird';
import { BigNumber } from 'ethers';
import {
  ConvexToken,
  CvxLockerV2,
  DelegateRegistry,
  PxCvx,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
  AddressRegistry,
  UnionPirexStrategy,
  UnionPirexVault,
} from '../typechain-types';

let admin: SignerWithAddress;
let notAdmin: SignerWithAddress;
let treasury: SignerWithAddress;
let contributors: SignerWithAddress;
let pirexCvx: PirexCvx;
let pxCvx: PxCvx;
let pirexFees: PirexFees;
let unionPirex: UnionPirexVault;
let unionPirexStrategy: UnionPirexStrategy;
let cvx: ConvexToken;
let crv: Crv;
let cvxLocker: CvxLockerV2;
let cvxLockerNew: CvxLockerV2;
let cvxDelegateRegistry: DelegateRegistry;
let votiumAddressRegistry: AddressRegistry;
let votiumMultiMerkleStash: MultiMerkleStash;

before(async function () {
  [admin, notAdmin, treasury, contributors] = await ethers.getSigners();

  const initialBalanceForAdmin = toBN(100e18);
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';

  this.zeroAddress = ethers.constants.AddressZero;

  // Deploy base contracts
  const curveVoterProxy = await (
    await ethers.getContractFactory('CurveVoterProxy')
  ).deploy();
  cvx = await (
    await ethers.getContractFactory('ConvexToken')
  ).deploy(curveVoterProxy.address);
  crv = await (await ethers.getContractFactory('Crv')).deploy();
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
  cvxLocker = await (
    await ethers.getContractFactory('CvxLockerV2')
  ).deploy(cvx.address, cvxCrvToken.address, baseRewardPool.address);
  cvxLockerNew = await (
    await ethers.getContractFactory('CvxLockerV2')
  ).deploy(cvx.address, cvxCrvToken.address, baseRewardPool.address);
  const cvxRewardPool = await (
    await ethers.getContractFactory('CvxRewardPool')
  ).deploy(
    cvx.address,
    crv.address,
    crvDepositorAddr,
    baseRewardPool.address,
    cvxCrvToken.address,
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
  const cvxStakingProxyNew = await (
    await ethers.getContractFactory('CvxStakingProxy')
  ).deploy(
    cvxLockerNew.address,
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
  await cvxLockerNew.setStakingContract(cvxStakingProxyNew.address);
  await cvxLockerNew.setApprovals();
  await cvxLockerNew.addReward(crv.address, admin.address, true);
  await cvxLockerNew.addReward(cvxCrvToken.address, admin.address, true);
  await cvxStakingProxy.setApprovals();
  await cvxStakingProxyNew.setApprovals();
  await cvx.mint(admin.address, initialBalanceForAdmin);
  await crv.mint(admin.address, initialBalanceForAdmin);
  await cvxCrvToken.mint(admin.address, initialBalanceForAdmin);

  pxCvx = await (await ethers.getContractFactory('PxCvx')).deploy();
  pirexFees = await (
    await ethers.getContractFactory('PirexFees')
  ).deploy(treasury.address, contributors.address);
  const upxCvx = await (
    await ethers.getContractFactory('ERC1155Solmate')
  ).deploy();
  const spxCvx = await (
    await ethers.getContractFactory('ERC1155Solmate')
  ).deploy();
  const vpxCvx = await (
    await ethers.getContractFactory('ERC1155PresetMinterSupply')
  ).deploy('');
  const rpxCvx = await (
    await ethers.getContractFactory('ERC1155PresetMinterSupply')
  ).deploy('');
  pirexCvx = await (
    await ethers.getContractFactory('PirexCvx')
  ).deploy(
    cvx.address,
    cvxLocker.address,
    cvxDelegateRegistry.address,
    pxCvx.address,
    upxCvx.address,
    spxCvx.address,
    vpxCvx.address,
    rpxCvx.address,
    pirexFees.address,
    votiumMultiMerkleStash.address
  );
  const unionPirexVault: any = await ethers.getContractFactory(
    'UnionPirexVault'
  );
  unionPirex = await unionPirexVault.deploy(pxCvx.address);
  unionPirexStrategy = await (
    await ethers.getContractFactory('UnionPirexStrategy')
  ).deploy(pirexCvx.address, pxCvx.address, admin.address, unionPirex.address);

  await unionPirex.setStrategy(unionPirexStrategy.address);

  // Common addresses and contracts
  this.admin = admin;
  this.notAdmin = notAdmin;
  this.treasury = treasury;
  this.contributors = contributors;
  this.cvx = cvx;
  this.crv = crv;
  this.cvxCrvToken = cvxCrvToken;
  this.cvxLocker = cvxLocker;
  this.cvxLockerNew = cvxLockerNew;
  this.cvxDelegateRegistry = cvxDelegateRegistry;
  this.votiumAddressRegistry = votiumAddressRegistry;
  this.votiumMultiMerkleStash = votiumMultiMerkleStash;
  this.pirexFees = pirexFees;
  this.pxCvx = pxCvx;
  this.pirexCvx = pirexCvx;
  this.unionPirex = unionPirex;
  this.unionPirexStrategy = unionPirexStrategy;

  await pxCvx.setOperator(this.pirexCvx.address);

  // Common constants
  this.feePercentDenominator = await pirexFees.PERCENT_DENOMINATOR();
  this.feeDenominator = await pirexCvx.FEE_DENOMINATOR();
  this.epochDuration = toBN(1209600);
  this.delegationSpace = 'cvx.eth';
  this.delegationSpaceBytes32 = ethers.utils.formatBytes32String(
    this.delegationSpace
  );
  this.contractEnum = {
    pxCvx: 0,
    pirexFees: 1,
    votium: 2,
    upxCvx: 3,
    spxCvx: 4,
    vpxCvx: 5,
    rpxCvx: 6,
    unionPirex: 7,
  };
  this.convexContractEnum = {
    cvxLocker: 0,
    cvxDelegateRegistry: 1,
  };
  this.futuresEnum = {
    vote: 0,
    reward: 1,
  };
  this.feesEnum = {
    reward: 0,
    redemptionMax: 1,
    redemptionMin: 2,
  };

  // Enable minting rights for PirexCvx contract
  const minterRole = await vpxCvx.MINTER_ROLE();
  await upxCvx.grantRole(minterRole, pirexCvx.address);
  await spxCvx.grantRole(minterRole, pirexCvx.address);
  await vpxCvx.grantRole(minterRole, pirexCvx.address);
  await rpxCvx.grantRole(minterRole, pirexCvx.address);

  // Common helper methods
  this.getFuturesCvxBalances = async (
    rounds: number,
    futures: number,
    currentEpoch: BigNumber
  ) =>
    await Promise.reduce(
      [...Array(rounds).keys()],
      async (acc: BigNumber[], _: number, idx: number) => {
        const epoch: BigNumber = currentEpoch
          .add(this.epochDuration)
          .add(this.epochDuration.mul(idx));
        const futuresCvx: any = await ethers.getContractAt(
          'ERC1155PresetMinterSupply',
          futures === this.futuresEnum.vote
            ? await pirexCvx.vpxCvx()
            : await pirexCvx.rpxCvx()
        );

        return [...acc, await futuresCvx.balanceOf(admin.address, epoch)];
      },
      []
    );
  this.getUpxCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155Solmate', address);
  this.getSpxCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155Solmate', address);
  this.getRpxCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155PresetMinterSupply', address);
  this.getVpxCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155PresetMinterSupply', address);
});
