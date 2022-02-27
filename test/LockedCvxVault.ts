import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { Promise } from 'bluebird';
import {
  callAndReturnEvents,
  toBN,
  getNumberBetweenRange,
  increaseBlockTimestamp,
} from './helpers';
import {
  Cvx,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
  CvxRewardPool,
  CvxStakingProxy,
  LockedCvxVault,
  CurveVoterProxy,
  VaultController,
} from '../typechain-types';

describe('LockedCvxVault', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let vaultController: VaultController;
  let lockedCvxVault: LockedCvxVault;
  let depositDeadline: BigNumber;

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

  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const underlyingTokenNameSymbol = 'lockedCVX';
  const initialCvxBalanceForAdmin = toBN(100e18);
  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const VaultController = await ethers.getContractFactory('VaultController');
    const LockedCvxVault = await ethers.getContractFactory('LockedCvxVault');

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
    vaultController = await VaultController.deploy(
      cvx.address,
      initialEpochDepositDuration
    );
    depositDeadline = (await vaultController.getCurrentEpoch()).add(
      await vaultController.epochDepositDuration()
    );
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
    lockedCvxVault = await LockedCvxVault.deploy(
      depositDeadline,
      cvxLocker.address,
      cvx.address,
      underlyingTokenNameSymbol,
      underlyingTokenNameSymbol
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
      const DEPOSIT_DEADLINE = await lockedCvxVault.DEPOSIT_DEADLINE();
      const CVX_LOCKER = await lockedCvxVault.CVX_LOCKER();
      const underlying = await lockedCvxVault.underlying();
      const baseUnit = await lockedCvxVault.baseUnit();
      const name = await lockedCvxVault.name();
      const symbol = await lockedCvxVault.symbol();
      const expectedBaseUnit = ethers.BigNumber.from(10).pow(
        await cvx.decimals()
      );
      
      expect(DEPOSIT_DEADLINE).to.equal(depositDeadline);
      expect(CVX_LOCKER).to.equal(cvxLocker.address);
      expect(underlying).to.equal(cvx.address);
      expect(baseUnit).to.equal(expectedBaseUnit);
      expect(name).to.equal(symbol).to.equal(underlyingTokenNameSymbol);
    });
  });

  describe('deposit', () => {
    it('Should deposit underlying', async () => {
      const depositAmount = toBN(1e18);
      const shareBalanceBefore = await lockedCvxVault.balanceOf(admin.address);
      const totalHoldingsBefore = await lockedCvxVault.totalHoldings();
      const depositAllowance = depositAmount;

      await cvx.approve(lockedCvxVault.address, depositAllowance);

      const events = await callAndReturnEvents(lockedCvxVault.deposit, [
        admin.address,
        depositAmount,
      ]);
      const shareBalanceAfter = await lockedCvxVault.balanceOf(admin.address);
      const totalHoldingsAfter = await lockedCvxVault.totalHoldings();
      const shareTransferEvent = events[0];
      const depositEvent = events[1];
      const underlyingAllowanceUpdateEvent = events[2];
      const underlyingTransferEvent = events[3];
      const cvxLockerApprovalEvent = events[4];
      const cvxLockerAllowanceUpdateEvent = events[5];
      const cvxLockerTransferEvent = events[6];

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore).to.equal(0);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(depositAmount)
        .to.be.gt(0);
      expect(shareTransferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(shareTransferEvent.args.from).to.equal(zeroAddress);
      expect(shareTransferEvent.args.to).to.equal(admin.address);
      expect(shareTransferEvent.args.value).to.equal(depositAmount);
      expect(depositEvent.eventSignature).to.equal(
        'Deposit(address,address,uint256)'
      );
      expect(depositEvent.args.from).to.equal(admin.address);
      expect(depositEvent.args.to).to.equal(admin.address);
      expect(depositEvent.args.underlyingAmount).to.equal(depositAmount);
      expect(underlyingAllowanceUpdateEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(underlyingAllowanceUpdateEvent.args.owner).to.equal(admin.address);
      expect(underlyingAllowanceUpdateEvent.args.spender).to.equal(
        lockedCvxVault.address
      );
      expect(underlyingAllowanceUpdateEvent.args.value)
        .to.equal(depositAllowance.sub(depositAmount))
        .to.equal(0);
      expect(underlyingTransferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(underlyingTransferEvent.args.from).to.equal(admin.address);
      expect(underlyingTransferEvent.args.to).to.equal(lockedCvxVault.address);
      expect(underlyingTransferEvent.args.value).to.equal(depositAmount);
      expect(cvxLockerApprovalEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(cvxLockerApprovalEvent.args.owner).to.equal(
        lockedCvxVault.address
      );
      expect(cvxLockerApprovalEvent.args.spender).to.equal(cvxLocker.address);
      expect(cvxLockerApprovalEvent.args.value).to.equal(depositAmount);
      expect(cvxLockerAllowanceUpdateEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(cvxLockerAllowanceUpdateEvent.args.owner).to.equal(
        lockedCvxVault.address
      );
      expect(cvxLockerAllowanceUpdateEvent.args.spender).to.equal(
        cvxLocker.address
      );
      expect(cvxLockerAllowanceUpdateEvent.args.value)
        .to.equal(depositAllowance.sub(depositAmount))
        .to.equal(0);
      expect(cvxLockerTransferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(cvxLockerTransferEvent.args.from).to.equal(lockedCvxVault.address);
      expect(cvxLockerTransferEvent.args.to).to.equal(cvxLocker.address);
      expect(cvxLockerTransferEvent.args.value).to.equal(depositAmount);
    });

    // Test that deposit works as expected on subsequent calls
    it('Should deposit underlying (N times)', async () => {
      const depositAmount = toBN(1e18);
      const iterations = getNumberBetweenRange(1, 10);
      const totalDeposit = depositAmount.mul(iterations);
      const shareBalanceBefore = await lockedCvxVault.balanceOf(admin.address);
      const totalHoldingsBefore = await lockedCvxVault.totalHoldings();

      await cvx.approve(lockedCvxVault.address, totalDeposit);
      await Promise.map(
        [...Array(iterations).keys()],
        async () => await lockedCvxVault.deposit(admin.address, depositAmount)
      );

      const shareBalanceAfter = await lockedCvxVault.balanceOf(admin.address);
      const totalHoldingsAfter = await lockedCvxVault.totalHoldings();

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(totalHoldingsBefore.add(totalDeposit))
        .to.be.gt(0);
    });

    it('Should revert if underlyingAmount is zero', async () => {
      const invalidDepositAmount = toBN(0);

      await expect(
        lockedCvxVault.deposit(admin.address, invalidDepositAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if depositing after deadline', async () => {
      const DEPOSIT_DEADLINE = await lockedCvxVault.DEPOSIT_DEADLINE();
      const epochDepositDuration = Number(
        (await vaultController.epochDepositDuration()).toString()
      );
      const depositAmount = toBN(1e18);

      await increaseBlockTimestamp(epochDepositDuration);

      const { timestamp: timestampAfterIncrease } =
        await ethers.provider.getBlock('latest');

      expect(timestampAfterIncrease).to.be.gt(DEPOSIT_DEADLINE);
      await expect(
        lockedCvxVault.deposit(admin.address, depositAmount)
      ).to.be.revertedWith(`AfterDeadline`);
    });
  });
});
