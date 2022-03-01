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
  VoteCvxVault,
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
  let firstVoteCvxVault: VoteCvxVault;
  let votiumMultiMerkleStash: any;
  let votiumAddressRegistry: any;

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
    const VotiumMultiMerkleStash: any = await ethers.getContractFactory(
      'MultiMerkleStash'
    );
    const VotiumAddressRegistry: any = await ethers.getContractFactory(
      'AddressRegistry'
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
    vaultController = await VaultController.deploy(
      cvx.address,
      cvxLocker.address,
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

  describe('createVoteCvxVault', () => {
    it('Should create a new VoteCvxVault instance', async () => {
      const currentEpoch = await vaultController.getCurrentEpoch();
      const vaultBeforeCreate = await vaultController.voteCvxVaultsByEpoch(
        currentEpoch
      );
      const events = await callAndReturnEvents(
        vaultController.createVoteCvxVault,
        [currentEpoch]
      );
      const createdVaultEvent = events[events.length - 1];
      const vaultAfterCreate = await vaultController.voteCvxVaultsByEpoch(
        currentEpoch
      );

      firstVoteCvxVault = await ethers.getContractAt(
        'VoteCvxVault',
        vaultAfterCreate
      );

      expect(vaultBeforeCreate).to.equal(zeroAddress);
      expect(createdVaultEvent.eventSignature).to.equal(
        'CreatedVoteCvxVault(address,string)'
      );
      expect(createdVaultEvent.args.vault)
        .to.equal(vaultAfterCreate)
        .to.equal(firstVoteCvxVault.address)
        .to.not.equal(zeroAddress);
      expect(createdVaultEvent.args.tokenId)
        .to.equal(`voteCVX-${currentEpoch}`)
        .to.not.equal(`voteCVX-${0}`);
    });

    it('Should revert if a vault already exists for the epoch', async () => {
      const existingVault = await vaultController.voteCvxVaultsByEpoch(
        firstVaultEpoch
      );

      expect(existingVault).to.equal(firstVoteCvxVault.address);
      await expect(
        vaultController.createVoteCvxVault(firstVaultEpoch)
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
      const expectedVoteCvxVaultEpochs = [...Array(8).keys()].map((_, idx) =>
        currentEpoch
          .add(EPOCH_DEPOSIT_DURATION)
          .add(EPOCH_DEPOSIT_DURATION.mul(idx))
      );
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const setUpEvent = events[events.length - 1];
      const actualVoteCvxVaults = await Promise.map(
        expectedVoteCvxVaultEpochs,
        async (voteEpoch) => {
          return vaultController.voteCvxVaultsByEpoch(voteEpoch);
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
      expect(setUpEvent.args.voteCvxVaults).to.deep.equal(actualVoteCvxVaults);
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
      const existingVoteCvxVaultEpochs = [...Array(8).keys()].map((_, idx) =>
        currentEpoch
          .add(EPOCH_DEPOSIT_DURATION)
          .add(EPOCH_DEPOSIT_DURATION.mul(idx))
      );
      const existingVoteCvxVaults = await Promise.map(
        existingVoteCvxVaultEpochs,
        async (voteEpoch) => {
          return vaultController.voteCvxVaultsByEpoch(voteEpoch);
        }
      );
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const {
        args: {
          lockedCvxVault: eventLockedCvxVault,
          voteCvxVaults: eventVoteCvxVaults,
          votiumRewardClaimer: eventVotiumRewardClaimer,
        },
      } = events[events.length - 1];
      const expectedLockedCvxVault =
        await vaultController.lockedCvxVaultsByEpoch(currentEpoch);
      const expectedVotiumRewardClaimer =
        await vaultController.votiumRewardClaimerByLockedCvxVault(
          expectedLockedCvxVault
        );
      const expectedVoteCvxVaults = await Promise.map(
        existingVoteCvxVaultEpochs,
        async (voteEpoch) => {
          return vaultController.voteCvxVaultsByEpoch(voteEpoch);
        }
      );

      expect(existingLockedCvxVault)
        .to.equal(expectedLockedCvxVault)
        .to.equal(eventLockedCvxVault);
      expect(existingVotiumRewardClaimer)
        .to.equal(expectedVotiumRewardClaimer)
        .to.equal(eventVotiumRewardClaimer);
      expect(existingVoteCvxVaults)
        .to.deep.equal(expectedVoteCvxVaults)
        .to.deep.equal(eventVoteCvxVaults);
    });
  });

  describe('deposit', () => {
    let EPOCH_DEPOSIT_DURATION: BigNumber;
    let getVoteCvxVaults: (startingEpoch: BigNumber) => Promise<{
      vaults: string[];
      balances: BigNumber[];
    }>;
    let voteCvxAddresses: string[];
    let voteCvxDeposits: BigNumber[];

    before(async () => {
      EPOCH_DEPOSIT_DURATION = await vaultController.EPOCH_DEPOSIT_DURATION();
      getVoteCvxVaults = async (startingEpoch: BigNumber) =>
        await Promise.reduce(
          [...Array(8).keys()],
          async (acc: { vaults: string[]; balances: BigNumber[] }, _, i) => {
            const epoch = startingEpoch.add(EPOCH_DEPOSIT_DURATION.mul(i));
            const v = await vaultController.voteCvxVaultsByEpoch(epoch);
            const voteCvxVault = await ethers.getContractAt('VoteCvxVault', v);
            const balance = await voteCvxVault.balanceOf(admin.address);
            const accVaults = acc.vaults.length ? [...acc.vaults] : [];
            const accBalances = acc.balances.length ? [...acc.balances] : [];

            return {
              vaults: [...accVaults, v],
              balances: [...accBalances, balance],
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
      const voteCvxStartingEpoch = currentEpoch.add(EPOCH_DEPOSIT_DURATION);
      const { vaults, balances } = await getVoteCvxVaults(voteCvxStartingEpoch);

      // Assign to cross-check in arbitrary deposit test
      voteCvxAddresses = vaults;
      voteCvxDeposits = [...Array(8).keys()].map(() => depositAmount);

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
      expect(balances).to.deep.equal(voteCvxDeposits);
      expect(voteCvxAddresses).to.not.include(zeroAddress);
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
      const voteCvxStartingEpoch = (
        await vaultController.getCurrentEpoch()
      ).add(EPOCH_DEPOSIT_DURATION);
      const { vaults, balances } = await getVoteCvxVaults(voteCvxStartingEpoch);

      // Update deposits and compare against balances (should retain parity)
      voteCvxDeposits = voteCvxDeposits.map((balance) =>
        balance.add(totalDeposit)
      );

      expect(shareBalanceBefore).to.equal(totalHoldingsBefore);
      expect(shareBalanceAfter)
        .to.equal(totalHoldingsAfter)
        .to.equal(shareBalanceBefore.add(totalDeposit))
        .to.be.gt(0);
      expect(vaults).to.deep.equal(voteCvxAddresses);
      expect(balances).to.deep.equal(voteCvxDeposits);
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
  });

  describe('mintVoteCvx', () => {
    it('Should mint voteCVX', async () => {
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const currentEpoch = await vaultController.getCurrentEpoch();
      const voteEpoch = currentEpoch.add(EPOCH_DEPOSIT_DURATION);
      const mintAmount = toBN(1e18);
      const events = await callAndReturnEvents(vaultController.setUpVaults, [
        currentEpoch,
      ]);
      const {
        args: { voteCvxVaults },
      } = events[events.length - 1];

      await vaultController.mintVoteCvx(voteEpoch, admin.address, mintAmount);

      const balances: BigNumber[] = await Promise.map(voteCvxVaults, async () =>
        (
          await ethers.getContractAt(
            'VoteCvxVault',
            await vaultController.voteCvxVaultsByEpoch(voteEpoch)
          )
        ).balanceOf(admin.address)
      );
      const expectedBalances = [...Array(balances.length).keys()].map(
        () => mintAmount
      );

      expect(balances).to.deep.equal(expectedBalances);
      // expect(balanceAfter).to.equal(expectedBalanceAfter).to.be.gt(0);
    });

    it('Should revert if minting voteCVX with an invalid VoteCvxVault', async () => {
      const EPOCH_DEPOSIT_DURATION =
        await vaultController.EPOCH_DEPOSIT_DURATION();
      const invalidEpoch = (await vaultController.getCurrentEpoch()).add(
        EPOCH_DEPOSIT_DURATION.mul(100)
      );
      const mintAmount = toBN(1e18);

      await expect(
        vaultController.mintVoteCvx(invalidEpoch, admin.address, mintAmount)
      ).to.be.revertedWith(
        'Transaction reverted: function call to a non-contract account'
      );
    });
  });
});
