import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import {
  Cvx,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
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

  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const underlyingTokenNameSymbol = 'lockedCVX';

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
});
