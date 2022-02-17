import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  convertBigNumberToNumber,
  toBN,
} from './helpers';
import { BigNumber } from 'ethers';
import {
  Cvx,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  CurveVoterProxy,
  CvxStakingProxy,
} from '../typechain-types';

describe('PirexCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;

  // Mocked Convex contracts
  let cvx: Cvx;
  let crv: Crv;

  // Seemingly invalid errors thrown for typechain types but they are correct
  let cvxCrvToken: any;
  let baseRewardPool: any;

  let curveVoterProxy: CurveVoterProxy;
  let booster: Booster;
  let rewardFactory: RewardFactory;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let cvxStakingProxy: CvxStakingProxy;

  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const cvxDelegateRegistry = '0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446';
  const votiumMultiMerkleStash = '0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A';
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const convexDelegateRegistryId =
    '0x6376782e65746800000000000000000000000000000000000000000000000000';
  const zeroAddress = '0x0000000000000000000000000000000000000000';


  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const PirexCvx = await ethers.getContractFactory('PirexCvx');

    // Mocked Convex contracts
    const Cvx = await ethers.getContractFactory('Cvx');
    const Crv = await ethers.getContractFactory('Crv');
    const CvxCrvToken = await ethers.getContractFactory('cvxCrvToken');
    const CurveVoterProxy = await ethers.getContractFactory('CurveVoterProxy');
    const Booster = await ethers.getContractFactory('Booster');
    const RewardFactory = await ethers.getContractFactory('RewardFactory');
    const BaseRewardPool = await ethers.getContractFactory(
      'contracts/mocks/BaseRewardPool.sol:BaseRewardPool'
    );
    const CvxLocker = await ethers.getContractFactory('CvxLocker');
    const CvxRewardPool = await ethers.getContractFactory('CvxRewardPool');
    const CvxStakingProxy = await ethers.getContractFactory('CvxStakingProxy');

    // Mocked Convex contracts
    cvx = await Cvx.deploy();
    crv = await Crv.deploy();
    cvxCrvToken = await CvxCrvToken.deploy();
    curveVoterProxy = await CurveVoterProxy.deploy();
    booster = await Booster.deploy(curveVoterProxy.address, cvx.address);
    rewardFactory = await RewardFactory.deploy(booster.address);
    baseRewardPool = await BaseRewardPool.deploy(
      0,
      cvxCrvToken.address,
      crv.address,
      booster.address,
      rewardFactory.address
    );
    cvxLocker = await CvxLocker.deploy(
      cvx.address,
      cvxCrvToken.address,
      baseRewardPool.address
    );
    cvxRewardPool = await CvxRewardPool.deploy(
      cvx.address,
      crvAddr,
      crvDepositorAddr,
      cvxCrvRewardsAddr,
      cvxCrvTokenAddr,
      booster.address,
      admin.address
    );
    cvxLockerLockDuration = await cvxLocker.lockDuration();
    cvxStakingProxy = await CvxStakingProxy.deploy(
      cvxLocker.address,
      cvxRewardPool.address,
      crv.address,
      cvx.address,
      cvxCrvToken.address
    );
    pirexCvx = await PirexCvx.deploy(
      cvxLocker.address,
      cvx.address,
      cvxRewardPool.address,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      initialEpochDepositDuration,
      cvxLockerLockDuration,
      admin.address,
      baseRewardPool.address,
      cvxCrvToken.address
    );

    await cvxLocker.setStakingContract(cvxStakingProxy.address);
    await cvxLocker.setApprovals();
    await cvxLocker.addReward(crv.address, admin.address, true);
    await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
    await cvxStakingProxy.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const owner = await pirexCvx.owner();
      const _cvxLocker = await pirexCvx.cvxLocker();
      const _cvx = await pirexCvx.cvx();
      const _cvxDelegateRegistry = await pirexCvx.cvxDelegateRegistry();
      const _votiumMultiMerkleStash = await pirexCvx.votiumMultiMerkleStash();
      const _epochDepositDuration = await pirexCvx.epochDepositDuration();
      const _lockDuration = await pirexCvx.lockDuration();
      const erc20Implementation = await pirexCvx.erc20Implementation();
      const voteDelegate = await pirexCvx.voteDelegate();
      const _votiumRewardManager = await pirexCvx.votiumRewardManager();

      expect(owner).to.equal(admin.address);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvx).to.equal(cvx.address);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry);
      expect(_votiumMultiMerkleStash).to.equal(votiumMultiMerkleStash);
      expect(_epochDepositDuration).to.equal(initialEpochDepositDuration);
      expect(_lockDuration).to.equal(cvxLockerLockDuration);
      expect(erc20Implementation).to.not.equal(zeroAddress);
      expect(voteDelegate).to.equal(admin.address);
      expect(_votiumRewardManager).to.equal(pirexCvx.address);
    });
  });

  describe('setVoteDelegate', () => {
    it('Should set voteDelegate', async () => {
      const voteDelegateBeforeSetting = await pirexCvx.voteDelegate();

      const setVoteDelegateEvent = await callAndReturnEvent(
        pirexCvx.setVoteDelegate,
        [convexDelegateRegistryId, notAdmin.address]
      );

      const voteDelegateAfterSetting = await pirexCvx.voteDelegate();

      expect(voteDelegateBeforeSetting).to.equal(admin.address);
      expect(voteDelegateBeforeSetting).to.not.equal(voteDelegateAfterSetting);
      expect(setVoteDelegateEvent.eventSignature).to.equal(
        'VoteDelegateSet(bytes32,address)'
      );
      expect(setVoteDelegateEvent.args.id).to.equal(convexDelegateRegistryId);
      expect(setVoteDelegateEvent.args.delegate).to.equal(notAdmin.address);
      expect(voteDelegateAfterSetting).to.equal(notAdmin.address);
    });

    it('Should revert if not called by owner', async () => {
      await expect(
        pirexCvx
          .connect(notAdmin)
          .setVoteDelegate(convexDelegateRegistryId, admin.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if delegate is zero address', async () => {
      await expect(
        pirexCvx.setVoteDelegate(convexDelegateRegistryId, zeroAddress)
      ).to.be.revertedWith('Invalid delegate');
    });
  });

  describe('setVotiumRewardManager', () => {
    it('Should set votiumRewardManager', async () => {
      const votiumRewardManagerBeforeSetting =
        await pirexCvx.votiumRewardManager();

      const setVotiumRewardManagerEvent = await callAndReturnEvent(
        pirexCvx.setVotiumRewardManager,
        [notAdmin.address]
      );

      const votiumRewardManagerAfterSetting =
        await pirexCvx.votiumRewardManager();

      expect(votiumRewardManagerBeforeSetting).to.equal(pirexCvx.address);
      expect(votiumRewardManagerBeforeSetting).to.not.equal(
        votiumRewardManagerAfterSetting
      );
      expect(setVotiumRewardManagerEvent.eventSignature).to.equal(
        'VotiumRewardManagerSet(address)'
      );
      expect(setVotiumRewardManagerEvent.args.manager).to.equal(
        notAdmin.address
      );
      expect(votiumRewardManagerAfterSetting).to.equal(notAdmin.address);
    });

    it('Should revert if not called by owner', async () => {
      await expect(
        pirexCvx.connect(notAdmin).setVotiumRewardManager(admin.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if manager is zero address', async () => {
      await expect(
        pirexCvx.setVotiumRewardManager(zeroAddress)
      ).to.be.revertedWith('Invalid manager');
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should get the current epoch', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const epochDepositDuration: number = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      expect(currentEpoch).to.equal(
        Math.floor(timestamp / epochDepositDuration) * epochDepositDuration
      );
    });
  });
});
