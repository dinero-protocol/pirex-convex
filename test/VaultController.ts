import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import {
  increaseBlockTimestamp,
  toBN,
  callAndReturnEvents,
  getNumberBetweenRange,
} from './helpers';
import {
  ConvexToken,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
  CvxRewardPool,
  CvxStakingProxy,
  CurveVoterProxy,
  VaultControllerMock,
  LockedCvxVault,
} from '../typechain-types';
import { BigNumber } from 'ethers';

describe('VaultController', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let vaultController: VaultControllerMock;

  // Mocked Convex contracts
  let cvx: ConvexToken;
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
  let cvxLockDuration: BigNumber;
  let firstVaultEpoch: BigNumber;
  let firstLockedCvxVault: LockedCvxVault;

  const epochDepositDuration = toBN(1209600); // 2 weeks in seconds
  const initialCvxBalanceForAdmin = toBN(100e18);
  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const VaultController = await ethers.getContractFactory(
      'VaultControllerMock'
    );

    // Mocked Convex contracts
    const Cvx = await ethers.getContractFactory('ConvexToken');
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
    curveVoterProxy = await CurveVoterProxy.deploy();
    cvx = await Cvx.deploy(curveVoterProxy.address);
    crv = await Crv.deploy();
    cvxCrvToken = await CvxCrvToken.deploy();
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
    cvxLockDuration = (await cvxLocker.lockDuration()).add(
      epochDepositDuration
    );
    vaultController = await VaultController.deploy(
      cvx.address,
      cvxLocker.address,
      epochDepositDuration,
      cvxLockDuration
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
    cvxStakingProxy = await CvxStakingProxy.deploy(
      cvxLocker.address,
      cvxRewardPool.address,
      crv.address,
      cvx.address,
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
      const CVX = await vaultController.CVX();
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const CVX_LOCK_DURATION = await vaultController.CVX_LOCK_DURATION();
      const expectedCvxLockDuration = (await cvxLocker.lockDuration()).add(
        EPOCH_DEPOSIT_DURATION
      );

      expect(CVX).to.equal(cvx.address);
      expect(EPOCH_DEPOSIT_DURATION).to.equal(epochDepositDuration);
      expect(CVX_LOCK_DURATION).to.equal(expectedCvxLockDuration);
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should get the current epoch', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const firstExpectedEpoch = toBN(timestamp)
        .div(EPOCH_DEPOSIT_DURATION)
        .mul(EPOCH_DEPOSIT_DURATION);
      const firstCurrentEpoch = await vaultController.getCurrentEpoch();

      await increaseBlockTimestamp(Number(EPOCH_DEPOSIT_DURATION.toString()));

      const secondExpectedEpoch = firstExpectedEpoch.add(
        EPOCH_DEPOSIT_DURATION
      );
      const secondCurrentEpoch = await vaultController.getCurrentEpoch();

      expect(firstCurrentEpoch).to.equal(firstExpectedEpoch);
      expect(secondCurrentEpoch).to.equal(secondExpectedEpoch);
    });
  });

  describe('createLockedCvxVault', () => {
    it('Should create a new LockedCvxVault instance', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const vaultBeforeCreate = await vaultController.lockedCvxVaultsByEpoch(
        currentEpoch
      );
      const events = await callAndReturnEvents(
        vaultController.createLockedCvxVault,
        [currentEpoch]
      );
      const createdVaultEvent = events[events.length - 1];
      const vaultAfterCreate = await vaultController.lockedCvxVaultsByEpoch(
        currentEpoch
      );
      const expectedDepositDeadline = currentEpoch.add(
        await vaultController.EPOCH_DEPOSIT_DURATION()
      );
      const expectedLockExpiry = expectedDepositDeadline.add(
        await vaultController.CVX_LOCK_DURATION()
      );

      firstVaultEpoch = currentEpoch;
      firstLockedCvxVault = await ethers.getContractAt(
        'LockedCvxVault',
        vaultAfterCreate
      );

      expect(vaultBeforeCreate).to.equal(zeroAddress);
      expect(createdVaultEvent.eventSignature).to.equal(
        'CreatedLockedCvxVault(address,uint256,uint256,string,string)'
      );
      expect(createdVaultEvent.args.vault)
        .to.equal(vaultAfterCreate)
        .to.not.equal(zeroAddress);
      expect(createdVaultEvent.args.depositDeadline)
        .to.equal(expectedDepositDeadline)
        .to.be.gt(currentEpoch);
      expect(createdVaultEvent.args.lockExpiry)
        .to.equal(expectedLockExpiry)
        .to.be.gt(expectedDepositDeadline);
      expect(createdVaultEvent.args.name)
        .to.equal(createdVaultEvent.args.symbol)
        .to.equal(`lockedCVX-${currentEpoch}`);
    });

    it('Should revert if vault already exists for epoch', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const vault = await vaultController.lockedCvxVaultsByEpoch(currentEpoch);

      expect(vault)
        .to.equal(firstLockedCvxVault.address)
        .to.not.equal(zeroAddress);
      await expect(
        vaultController.createLockedCvxVault(currentEpoch)
      ).to.be.revertedWith(`VaultExistsForEpoch(${currentEpoch})`);
    });
  });

  describe('deposit', () => {
    it('Should deposit CVX', async () => {
      const depositAmount = toBN(1e18);
      const shareBalanceBefore = await firstLockedCvxVault.balanceOf(
        admin.address
      );
      const totalHoldingsBefore = await firstLockedCvxVault.totalHoldings();
      const depositAllowance = depositAmount;

      await cvx.approve(vaultController.address, depositAllowance);

      const events = await callAndReturnEvents(vaultController.deposit, [
        admin.address,
        depositAmount,
      ]);
      const shareBalanceAfter = await firstLockedCvxVault.balanceOf(
        admin.address
      );
      const totalHoldingsAfter = await firstLockedCvxVault.totalHoldings();
      const depositEvent = events[events.length - 1];
      const currentEpoch = await vaultController.getCurrentEpoch();

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore).to.equal(0);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(depositAmount)
        .to.be.gt(0);
      expect(depositEvent.eventSignature).to.equal(
        'Deposited(uint256,address,uint256)'
      );
      expect(depositEvent.args.epoch).to.equal(currentEpoch).to.be.gt(0);
      expect(depositEvent.args.to)
        .to.equal(admin.address)
        .to.not.equal(zeroAddress);
      expect(depositEvent.args.amount).to.equal(depositAmount).to.be.gt(0);
    });

    it('Should deposit CVX (N times)', async () => {
      const depositAmount = toBN(1e18);
      const iterations = getNumberBetweenRange(1, 10);
      const totalDeposit = depositAmount.mul(iterations);
      const shareBalanceBefore = await firstLockedCvxVault.balanceOf(
        admin.address
      );
      const totalHoldingsBefore = await firstLockedCvxVault.totalHoldings();

      await cvx.approve(vaultController.address, totalDeposit);
      await Promise.map(
        [...Array(iterations).keys()],
        async () => await vaultController.deposit(admin.address, depositAmount)
      );

      const shareBalanceAfter = await firstLockedCvxVault.balanceOf(
        admin.address
      );
      const totalHoldingsAfter = await firstLockedCvxVault.totalHoldings();

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(shareBalanceBefore.add(totalDeposit))
        .to.be.gt(0);
    });
  });

  describe('withdraw', () => {
    it('Should revert if withdrawing before vault lock expiry', async () => {
      const withdrawAmount = toBN(1e18);

      await firstLockedCvxVault.approve(
        vaultController.address,
        withdrawAmount
      );

      await expect(
        vaultController.withdraw(firstVaultEpoch, admin.address, withdrawAmount)
      ).to.be.revertedWith('BeforeLockExpiry');
    });

    it('Should withdraw if after vault lock expiry', async () => {
      const lockExpiry = await firstLockedCvxVault.lockExpiry();
      const { timestamp: timestampBefore } = await ethers.provider.getBlock(
        'latest'
      );
      const timestampIncreaseAmount = Number(
        lockExpiry.sub(timestampBefore).add(1).toString()
      );

      await increaseBlockTimestamp(timestampIncreaseAmount);

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );
      const withdrawAmount = toBN(1e18);
      const events = await callAndReturnEvents(vaultController.withdraw, [
        firstVaultEpoch,
        admin.address,
        withdrawAmount,
      ]);
      const withdrawEvent = events[events.length - 1];

      expect(lockExpiry.lt(timestampBefore)).to.equal(false);
      expect(lockExpiry.lt(timestampAfter)).to.equal(true);
      expect(withdrawEvent.eventSignature).to.equal(
        'Withdrew(uint256,address,uint256)'
      );
      expect(withdrawEvent.args.epoch).to.equal(firstVaultEpoch);
      expect(withdrawEvent.args.to).to.equal(admin.address);
      expect(withdrawEvent.args.amount).to.equal(withdrawAmount);
    });
  });
});
