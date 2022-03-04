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
  RewardCvxVault,
  VotiumRewardClaimer,
  DelegateRegistry,
} from '../typechain-types';
import { BigNumber } from 'ethers';

describe('VaultController', () => {
  let admin: SignerWithAddress;
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
  let firstRewardCvxVault: RewardCvxVault;
  let firstVotiumRewardClaimer: VotiumRewardClaimer;
  let votiumMultiMerkleStash: any;
  let votiumAddressRegistry: any;
  let convexDelegateRegistry: DelegateRegistry;

  const epochDepositDuration = toBN(1209600); // 2 weeks in seconds
  const initialCvxBalanceForAdmin = toBN(100e18);
  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin] = await ethers.getSigners();

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
    const VotiumMultiMerkleStash: any = await ethers.getContractFactory(
      'MultiMerkleStash'
    );
    const VotiumAddressRegistry: any = await ethers.getContractFactory(
      'AddressRegistry'
    );
    const ConvexDelegateRegistry = await ethers.getContractFactory(
      'DelegateRegistry'
    );

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
    votiumMultiMerkleStash = await VotiumMultiMerkleStash.deploy();
    votiumAddressRegistry = await VotiumAddressRegistry.deploy();
    convexDelegateRegistry = await ConvexDelegateRegistry.deploy();
    vaultController = await VaultController.deploy(
      cvx.address,
      cvxLocker.address,
      convexDelegateRegistry.address,
      votiumMultiMerkleStash.address,
      votiumAddressRegistry.address,
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
        'CreatedLockedCvxVault(address,uint256,uint256,string)'
      );
      expect(createdVaultEvent.args.vault)
        .to.equal(vaultAfterCreate)
        .to.equal(firstLockedCvxVault.address)
        .to.not.equal(zeroAddress);
      expect(createdVaultEvent.args.depositDeadline)
        .to.equal(expectedDepositDeadline)
        .to.be.gt(currentEpoch);
      expect(createdVaultEvent.args.lockExpiry)
        .to.equal(expectedLockExpiry)
        .to.be.gt(expectedDepositDeadline);
      expect(createdVaultEvent.args.tokenId)
        .to.equal(`lockedCVX-${currentEpoch}`)
        .to.not.equal(`lockedCVX-${0}`);
    });

    it('Should revert if a vault already exists for the epoch', async () => {
      const existingVault = await vaultController.lockedCvxVaultsByEpoch(
        firstVaultEpoch
      );

      expect(existingVault).to.equal(firstLockedCvxVault.address);
      await expect(
        vaultController.createLockedCvxVault(firstVaultEpoch)
      ).to.be.revertedWith('AlreadyExists()');
    });
  });

  describe('createRewardCvxVault', () => {
    it('Should create a new RewardCvxVault instance', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const vaultBeforeCreate = await vaultController.rewardCvxVaultsByEpoch(
        currentEpoch
      );
      const events = await callAndReturnEvents(
        vaultController.createRewardCvxVault,
        [currentEpoch]
      );
      const createdVaultEvent = events[events.length - 1];
      const vaultAfterCreate = await vaultController.rewardCvxVaultsByEpoch(
        currentEpoch
      );

      firstRewardCvxVault = await ethers.getContractAt(
        'RewardCvxVault',
        vaultAfterCreate
      );

      expect(vaultBeforeCreate).to.equal(zeroAddress);
      expect(createdVaultEvent.eventSignature).to.equal(
        'CreatedRewardCvxVault(address,uint256,string)'
      );
      expect(createdVaultEvent.args.vault)
        .to.equal(vaultAfterCreate)
        .to.equal(firstRewardCvxVault.address)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if a vault already exists for the epoch', async () => {
      const existingVault = await vaultController.rewardCvxVaultsByEpoch(
        firstVaultEpoch
      );

      expect(existingVault).to.equal(firstRewardCvxVault.address);
      await expect(
        vaultController.createRewardCvxVault(firstVaultEpoch)
      ).to.be.revertedWith('AlreadyExists()');
    });
  });

  describe('setUpVaults', () => {
    it('Should set up vaults for an epoch', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const expectedLockedCvxVault =
        await vaultController.lockedCvxVaultsByEpoch(currentEpoch);
      const expectedRewardCvxVaultEpochs = [...Array(8).keys()].map((_, idx) =>
        currentEpoch
          .add(EPOCH_DEPOSIT_DURATION)
          .add(EPOCH_DEPOSIT_DURATION.mul(idx))
      );
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const setUpEvent = events[events.length - 1];
      const actualRewardCvxVaults = await Promise.map(
        expectedRewardCvxVaultEpochs,
        async (tokenEpoch) => {
          return vaultController.rewardCvxVaultsByEpoch(tokenEpoch);
        }
      );
      const expectedVotiumRewardClaimer =
        await vaultController.votiumRewardClaimerByLockedCvxVault(
          expectedLockedCvxVault
        );
      const votiumRewardClaimerOnLockedCvxVault = await (
        await ethers.getContractAt(
          'LockedCvxVault',
          setUpEvent.args.lockedCvxVault
        )
      ).votiumRewardClaimer();
      const votiumRewardClaimerOnVotiumAddressRegistry = (
        await votiumAddressRegistry.registry(setUpEvent.args.lockedCvxVault)
      ).to;

      expect(setUpEvent.eventSignature).to.equal(
        'SetUpVaults(address,address[8],address)'
      );
      expect(setUpEvent.args.lockedCvxVault).to.equal(expectedLockedCvxVault);
      expect(setUpEvent.args.rewardCvxVaults).to.deep.equal(
        actualRewardCvxVaults
      );
      expect(setUpEvent.args.votiumRewardClaimer)
        .to.equal(expectedVotiumRewardClaimer)
        .to.equal(votiumRewardClaimerOnLockedCvxVault)
        .to.equal(votiumRewardClaimerOnVotiumAddressRegistry);
    });

    it('Should not create new vaults if they exist', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const existingLockedCvxVault =
        await vaultController.lockedCvxVaultsByEpoch(currentEpoch);
      const existingVotiumRewardClaimer =
        await vaultController.votiumRewardClaimerByLockedCvxVault(
          existingLockedCvxVault
        );
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const existingRewardCvxVaultEpochs = [...Array(8).keys()].map((_, idx) =>
        currentEpoch
          .add(EPOCH_DEPOSIT_DURATION)
          .add(EPOCH_DEPOSIT_DURATION.mul(idx))
      );
      const existingRewardCvxVaults = await Promise.map(
        existingRewardCvxVaultEpochs,
        async (tokenEpoch) => {
          return vaultController.rewardCvxVaultsByEpoch(tokenEpoch);
        }
      );
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const {
        args: {
          lockedCvxVault: eventLockedCvxVault,
          rewardCvxVaults: eventRewardCvxVaults,
          votiumRewardClaimer: eventVotiumRewardClaimer,
        },
      } = events[events.length - 1];
      const expectedLockedCvxVault =
        await vaultController.lockedCvxVaultsByEpoch(currentEpoch);
      const expectedVotiumRewardClaimer =
        await vaultController.votiumRewardClaimerByLockedCvxVault(
          expectedLockedCvxVault
        );

      firstVotiumRewardClaimer = await ethers.getContractAt(
        'VotiumRewardClaimer',
        expectedVotiumRewardClaimer
      );

      const expectedRewardCvxVaults = await Promise.map(
        existingRewardCvxVaultEpochs,
        async (tokenEpoch) => {
          return vaultController.rewardCvxVaultsByEpoch(tokenEpoch);
        }
      );
      const rewardClaimers = await Promise.map(
        eventRewardCvxVaults,
        async (rewardCvxVault: string) => {
          return (
            await ethers.getContractAt('RewardCvxVault', rewardCvxVault)
          ).rewardClaimer();
        }
      );
      const expectedRewardClaimers = [...Array(8).keys()].map(
        () => firstVotiumRewardClaimer.address
      );

      expect(existingLockedCvxVault)
        .to.equal(expectedLockedCvxVault)
        .to.equal(eventLockedCvxVault);
      expect(existingVotiumRewardClaimer)
        .to.equal(expectedVotiumRewardClaimer)
        .to.equal(firstVotiumRewardClaimer.address)
        .to.equal(eventVotiumRewardClaimer);
      expect(existingRewardCvxVaults)
        .to.deep.equal(expectedRewardCvxVaults)
        .to.deep.equal(eventRewardCvxVaults);
      expect(rewardClaimers).to.deep.equal(expectedRewardClaimers);
    });

    it('Should revert if epoch is zero', async () => {
      const invalidEpoch = 0;

      await expect(
        vaultController.setUpVaults(invalidEpoch)
      ).to.be.revertedWith(`InvalidVaultEpoch(${invalidEpoch})`);
    });
  });

  describe('createVotiumRewardClaimer', () => {
    it('Should revert if a vault already exists for the epoch', async () => {
      const lockedCvxVault = firstLockedCvxVault.address;
      const rewardCvxVaults = [...Array(8).keys()].map(
        () => firstRewardCvxVault.address
      );
      const currentEpoch = await vaultController.getCurrentEpoch();
      const tokenEpochs = [...Array(8).keys()].map(() => currentEpoch);
      const existingVault =
        await vaultController.votiumRewardClaimerByLockedCvxVault(
          firstLockedCvxVault.address
        );

      expect(existingVault).to.equal(firstVotiumRewardClaimer.address);
      await expect(
        vaultController.createVotiumRewardClaimer(
          lockedCvxVault,
          rewardCvxVaults,
          tokenEpochs
        )
      ).to.be.revertedWith('AlreadyExists()');
    });
  });

  describe('deposit', () => {
    let EPOCH_DEPOSIT_DURATION: BigNumber;
    let getRewardCvxVaults: (startingEpoch: BigNumber) => Promise<{
      vaults: string[];
      balances: BigNumber[];
    }>;
    let rewardCvxAddresses: string[];
    let rewardCvxDeposits: BigNumber[];

    before(async () => {
      EPOCH_DEPOSIT_DURATION = await vaultController.EPOCH_DEPOSIT_DURATION();
      getRewardCvxVaults = async (startingEpoch: BigNumber) =>
        await Promise.reduce(
          [...Array(8).keys()],
          async (
            acc: {
              vaults: string[];
              balances: BigNumber[];
            },
            _,
            i
          ) => {
            const epoch = startingEpoch.add(EPOCH_DEPOSIT_DURATION.mul(i));
            const v = await vaultController.rewardCvxVaultsByEpoch(epoch);
            const rewardCvxVault = await ethers.getContractAt(
              'RewardCvxVault',
              v
            );
            const accVaults = acc.vaults.length ? [...acc.vaults] : [];
            const accBalances = acc.balances.length ? [...acc.balances] : [];

            return {
              vaults: [...accVaults, v],
              balances: [
                ...accBalances,
                await rewardCvxVault.balanceOf(admin.address),
              ],
            };
          },
          { vaults: [], balances: [] }
        );
    });

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
      const rewardCvxStartingEpoch = currentEpoch.add(EPOCH_DEPOSIT_DURATION);
      const { vaults, balances } = await getRewardCvxVaults(
        rewardCvxStartingEpoch
      );

      // Assign to cross-check in arbitrary deposit test
      rewardCvxAddresses = vaults;
      rewardCvxDeposits = [...Array(8).keys()].map(() => depositAmount);

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
      expect(balances.length).to.equal(8).to.equal(vaults.length);
      expect(balances).to.deep.equal(rewardCvxDeposits);
      expect(rewardCvxAddresses).to.not.include(zeroAddress);
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
      const rewardCvxStartingEpoch = (
        await vaultController.getCurrentEpoch()
      ).add(EPOCH_DEPOSIT_DURATION);
      const { vaults, balances } = await getRewardCvxVaults(
        rewardCvxStartingEpoch
      );

      // Update deposits and compare against balances (should retain parity)
      rewardCvxDeposits = rewardCvxDeposits.map((balance) =>
        balance.add(totalDeposit)
      );

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(shareBalanceBefore.add(totalDeposit))
        .to.be.gt(0);
      expect(vaults).to.deep.equal(rewardCvxAddresses);
      expect(balances).to.deep.equal(rewardCvxDeposits);
    });
  });

  describe('redeem', () => {
    it('Should revert if redeeming before vault lock expiry', async () => {
      const redeemAmount = toBN(1e18);

      await firstLockedCvxVault.approve(vaultController.address, redeemAmount);

      await expect(
        vaultController.redeem(firstVaultEpoch, admin.address, redeemAmount)
      ).to.be.revertedWith('BeforeLockExpiry');
    });

    it('Should redeem if after vault lock expiry', async () => {
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
      const redeemAmount = toBN(1e18);
      const events = await callAndReturnEvents(vaultController.redeem, [
        firstVaultEpoch,
        admin.address,
        redeemAmount,
      ]);
      const redeemEvent = events[events.length - 1];

      expect(lockExpiry.lt(timestampBefore)).to.equal(false);
      expect(lockExpiry.lt(timestampAfter)).to.equal(true);
      expect(redeemEvent.eventSignature).to.equal(
        'Redeemed(uint256,address,uint256)'
      );
      expect(redeemEvent.args.epoch).to.equal(firstVaultEpoch);
      expect(redeemEvent.args.to).to.equal(admin.address);
      expect(redeemEvent.args.amount).to.equal(redeemAmount);
    });

    it('Should revert if epoch is zero', async () => {
      const invalidEpoch = 0;
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        vaultController.redeem(invalidEpoch, to, amount)
      ).to.be.revertedWith(`InvalidVaultEpoch(${invalidEpoch})`);
    });

    it('Should revert if epoch is invalid', async () => {
      const invalidEpoch = (await vaultController.getCurrentEpoch())
        .add(await vaultController.EPOCH_DEPOSIT_DURATION())
        .mul(2);
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        vaultController.redeem(invalidEpoch, to, amount)
      ).to.be.revertedWith(`InvalidVaultEpoch(${invalidEpoch})`);
    });
  });

  describe('mintRewardCvxTokens', () => {
    it('Should mint reward CVX', async () => {
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const currentEpoch = await vaultController.getCurrentEpoch();
      const tokenEpoch = currentEpoch.add(EPOCH_DEPOSIT_DURATION);
      const mintAmount = toBN(1e18);
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const {
        args: { rewardCvxVaults },
      } = events[events.length - 1];

      await vaultController.mintRewardCvxTokens(
        tokenEpoch,
        admin.address,
        mintAmount
      );

      const balances: BigNumber[] = await Promise.map(
        rewardCvxVaults,
        async () =>
          (
            await ethers.getContractAt(
              'RewardCvxVault',
              await vaultController.rewardCvxVaultsByEpoch(tokenEpoch)
            )
          ).balanceOf(admin.address)
      );
      const expectedBalances = [...Array(balances.length).keys()].map(
        () => mintAmount
      );

      expect(balances).to.deep.equal(expectedBalances);
    });

    it('Should revert if minting vote, bribe, and reward CVX with an invalid RewardCvxVault', async () => {
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const invalidEpoch = (await vaultController.getCurrentEpoch()).add(
        EPOCH_DEPOSIT_DURATION.mul(100)
      );
      const mintAmount = toBN(1e18);

      await expect(
        vaultController.mintRewardCvxTokens(
          invalidEpoch,
          admin.address,
          mintAmount
        )
      ).to.be.revertedWith(
        'Transaction reverted: function call to a non-contract account'
      );
    });

    it('Should revert if startingEpoch is less than the next epoch', async () => {
      const nextEpoch = (await vaultController.getCurrentEpoch()).add(
        await vaultController.EPOCH_DEPOSIT_DURATION()
      );
      const invalidEpoch = nextEpoch.sub(1);
      const to = admin.address;
      const mintAmount = toBN(1e18);

      await expect(
        vaultController.mintRewardCvxTokens(invalidEpoch, to, mintAmount)
      ).to.be.revertedWith(`AfterMintDeadline(${invalidEpoch})`);
    });

    it('Should revert if zero address', async () => {
      const nextEpoch = (await vaultController.getCurrentEpoch()).add(
        await vaultController.EPOCH_DEPOSIT_DURATION()
      );
      const invalidTo = zeroAddress;
      const mintAmount = toBN(1e18);

      await expect(
        vaultController.mintRewardCvxTokens(nextEpoch, invalidTo, mintAmount)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if zero amount', async () => {
      const nextEpoch = (await vaultController.getCurrentEpoch()).add(
        await vaultController.EPOCH_DEPOSIT_DURATION()
      );
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(
        vaultController.mintRewardCvxTokens(nextEpoch, to, invalidAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });
  });
});
