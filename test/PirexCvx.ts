import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
  impersonateAddressAndReturnSigner,
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
  MultiMerkleStash,
  MultiMerkleStash__factory,
  VotiumRewardManager,
  CurveVoterProxy,
  CvxStakingProxy,
} from '../typechain-types';
import { BalanceTree } from '../lib/merkle';

describe('PirexCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let votiumOwner: SignerWithAddress;
  let pirexCvx: PirexCvx;
  let votiumRewardManager: VotiumRewardManager;
  let multiMerkleStash: MultiMerkleStash;
  let rewardToken: Cvx;
  let cvxLockerLockDuration: BigNumber;
  let firstDepositEpoch: BigNumber;
  let firstVoteAndRewardEpoch: BigNumber;
  let secondDepositEpoch: BigNumber;

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
  const defaultSpendRatio = 0;
  const convexDelegateRegistryId =
    '0x6376782e65746800000000000000000000000000000000000000000000000000';
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const lockedCvxPrefix = 'lockedCVX';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const PirexCvx = await ethers.getContractFactory('PirexCvx');
    const VotiumRewardManager = await ethers.getContractFactory(
      'VotiumRewardManager'
    );

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
      baseRewardPool.address
    );
    votiumRewardManager = await VotiumRewardManager.deploy(
      pirexCvx.address,
      cvx.address
    );

    // Setup Votium's multiMerkleStash by impersonating the Votium multisig
    multiMerkleStash = await MultiMerkleStash__factory.connect(
      votiumMultiMerkleStash,
      ethers.provider
    );
    const votiumMultisig = await multiMerkleStash.owner();
    votiumOwner = await impersonateAddressAndReturnSigner(
      admin,
      votiumMultisig
    );
    // Mock reward token
    rewardToken = await Cvx.deploy();

    await cvxLocker.setStakingContract(cvxStakingProxy.address);
    await cvxLocker.setApprovals();
    await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
    await cvxStakingProxy.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt('ERC20PresetMinterPauserUpgradeable', address);

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

  describe('deposit', () => {
    it('Should deposit CVX', async () => {
      // Move the timestamp to the beginning of next epoch to ensure consistent tests run
      const { timestamp } = await ethers.provider.getBlock('latest');
      const currentEpoch = convertBigNumberToNumber(
        await pirexCvx.getCurrentEpoch()
      );
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const timeUntilNextEpoch =
        currentEpoch + epochDepositDuration - timestamp;
      await increaseBlockTimestamp(timeUntilNextEpoch + 60); // Shift by 1 minute for safety

      const userCvxTokensBeforeDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxTokensBeforeDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);

      firstDepositEpoch = await pirexCvx.getCurrentEpoch();

      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);
      const rewardsDuration = convertBigNumberToNumber(
        await cvxLocker.rewardsDuration()
      );

      // Convex does not reflect actual locked CVX until their next epoch (1 week)
      await increaseBlockTimestamp(rewardsDuration);

      const userCvxTokensAfterDeposit = await cvx.balanceOf(admin.address);
      const pirexLockedCvxAfterDeposit = await cvxLocker.balanceOf(
        pirexCvx.address
      );

      // Store to test withdrawing tokens for this specific epoch later
      const pirexCvxToken = await getPirexCvxToken(depositEvent.args.token);
      const userPirexCvxTokens = await pirexCvxToken.balanceOf(admin.address);
      const lockDuration = await pirexCvx.lockDuration();
      const expectedEpochs = [...Array(8).keys()].map((_, idx) =>
        toBN(
          convertBigNumberToNumber(firstDepositEpoch) +
            epochDepositDuration * (idx + 1)
        )
      );
      const voteEpochTokenAddresses = await Promise.map(
        expectedEpochs,
        async (epoch: BigNumber) => await pirexCvx.voteEpochs(epoch)
      );
      const rewardEpochTokenAddresses = await Promise.map(
        expectedEpochs,
        async (epoch: BigNumber) => await pirexCvx.rewardEpochs(epoch)
      );

      firstVoteAndRewardEpoch = expectedEpochs[0];

      expect(userCvxTokensAfterDeposit).to.equal(
        userCvxTokensBeforeDeposit.sub(depositAmount)
      );
      expect(pirexLockedCvxAfterDeposit).to.equal(
        pirexLockedCvxTokensBeforeDeposit.add(depositAmount)
      );
      expect(depositEvent.eventSignature).to.equal(
        'Deposited(uint256,uint256,uint256,uint256,address,uint256[8])'
      );
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(depositEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(depositEvent.args.lockExpiry).to.equal(
        firstDepositEpoch.add(epochDepositDuration).add(lockDuration)
      );
      expect(depositEvent.args.token).to.not.equal(zeroAddress);
      expect(userPirexCvxTokens).to.equal(depositAmount);
      expect(depositEvent.args.epochs).to.deep.equal(expectedEpochs);
      expect(
        depositEvent.args.lockExpiry.gte(
          expectedEpochs[expectedEpochs.length - 1]
        )
      ).to.equal(true);
      expect(voteEpochTokenAddresses).to.not.include(
        '0x0000000000000000000000000000000000000000'
      );
      expect(rewardEpochTokenAddresses).to.not.include(
        '0x0000000000000000000000000000000000000000'
      );
    });

    it('Should mint the correct amount of user tokens on subsequent deposits', async () => {
      const currentEpoch = firstDepositEpoch;
      const { token, lockExpiry } = await pirexCvx.deposits(currentEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);
      const userPirexCvxTokensBeforeDeposit = await pirexCvxToken.balanceOf(
        admin.address
      );
      const depositAmount = toBN(1e18);

      await cvx.approve(pirexCvx.address, depositAmount);
      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);

      const userPirexCvxTokensAfterDeposit = await pirexCvxToken.balanceOf(
        admin.address
      );
      const { token: tokenAfterDeposit, lockExpiry: lockExpiryAfterDeposit } =
        await pirexCvx.deposits(currentEpoch);

      expect(userPirexCvxTokensAfterDeposit).to.equal(
        userPirexCvxTokensBeforeDeposit.add(depositAmount)
      );
      expect(token).to.equal(tokenAfterDeposit);
      expect(lockExpiry).to.equal(lockExpiryAfterDeposit);
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(depositEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(depositEvent.args.epoch).to.equal(currentEpoch);
      expect(depositEvent.args.lockExpiry).to.equal(lockExpiry);
      expect(depositEvent.args.token).to.equal(token);
    });

    it('Should mint a new token for a new epoch', async () => {
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const currentEpoch = firstDepositEpoch;
      const { token: currentEpochToken } = await pirexCvx.deposits(
        currentEpoch
      );
      const pirexCvxTokenForCurrentEpoch = await getPirexCvxToken(
        currentEpochToken
      );
      const pirexCvxTokenForCurrentEpochName =
        await pirexCvxTokenForCurrentEpoch.name();
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const depositAmount = toBN(1e18);

      // Store to conveniently withdraw tokens for a specific epoch later
      secondDepositEpoch = nextEpoch;

      // Fast forward 1 epoch
      await increaseBlockTimestamp(epochDepositDuration);
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      const { token: nextEpochToken } = await pirexCvx.deposits(nextEpoch);
      const pirexCvxTokenForNextEpoch = await getPirexCvxToken(nextEpochToken);
      const pirexCvxTokenForNextEpochName =
        await pirexCvxTokenForNextEpoch.name();
      const userPirexCvxTokensForNextEpoch =
        await pirexCvxTokenForNextEpoch.balanceOf(admin.address);

      expect(pirexCvxTokenForCurrentEpochName).to.equal(
        `${lockedCvxPrefix}-${currentEpoch}`
      );
      expect(pirexCvxTokenForNextEpochName).to.equal(
        `${lockedCvxPrefix}-${nextEpoch}`
      );
      expect(pirexCvxTokenForCurrentEpoch.address).to.not.equal(
        pirexCvxTokenForNextEpoch.address
      );
      expect(userPirexCvxTokensForNextEpoch).to.equal(depositAmount);
    });
  });

  describe('withdraw', () => {
    it('Should revert if invalid epoch', async () => {
      await expect(pirexCvx.withdraw(0, defaultSpendRatio)).to.be.revertedWith(
        'Invalid epoch'
      );
    });

    it('Should revert if withdrawing CVX before lock expiry', async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      await expect(
        pirexCvx.withdraw(currentEpoch, defaultSpendRatio)
      ).to.be.revertedWith('Cannot withdraw before lock expiry');
    });

    it('Should withdraw CVX if after lock expiry (first epoch deposit)', async () => {
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const lockDuration = convertBigNumberToNumber(
        await pirexCvx.lockDuration()
      );
      const { token } = await pirexCvx.deposits(firstDepositEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);

      // Fast forward to after lock expiry
      await increaseBlockTimestamp(epochDepositDuration + lockDuration);

      const userPirexCvxTokensBeforeWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensBeforeWithdraw = await cvx.balanceOf(admin.address);
      const { unlockable: pirexUnlockableCvxTokensBeforeWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);
      const pirexStakedCvxTokensBeforeWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      await pirexCvxToken.approve(
        pirexCvx.address,
        userPirexCvxTokensBeforeWithdraw
      );

      const withdrawEvent = await callAndReturnEvent(pirexCvx.withdraw, [
        firstDepositEpoch,
        defaultSpendRatio,
      ]);
      const userPirexCvxTokensAfterWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensAfterWithdraw = await cvx.balanceOf(admin.address);
      const { unlockable: pirexUnlockableCvxTokensAfterWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);
      const pirexStakedCvxTokensAfterWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensAfterWithdraw = await cvx.balanceOf(pirexCvx.address);

      expect(userPirexCvxTokensAfterWithdraw).to.equal(0);
      expect(pirexUnlockableCvxTokensAfterWithdraw).to.equal(0);
      expect(pirexCvxTokensAfterWithdraw).to.equal(0);
      expect(userCvxTokensAfterWithdraw).to.equal(
        userCvxTokensBeforeWithdraw.add(userPirexCvxTokensBeforeWithdraw)
      );
      expect(withdrawEvent.eventSignature).to.equal(
        'Withdrew(uint256,uint256,uint256,uint256,address,uint256,uint256)'
      );
      expect(withdrawEvent.args.amount).to.equal(
        userPirexCvxTokensBeforeWithdraw
      );
      expect(withdrawEvent.args.spendRatio).to.equal(defaultSpendRatio);
      expect(withdrawEvent.args.epoch).to.equal(firstDepositEpoch);
      expect(withdrawEvent.args.lockExpiry).to.equal(
        firstDepositEpoch.add(epochDepositDuration).add(lockDuration)
      );
      expect(withdrawEvent.args.token).to.equal(pirexCvxToken.address);
      expect(withdrawEvent.args.unlocked).to.equal(
        pirexUnlockableCvxTokensBeforeWithdraw
      );
      expect(withdrawEvent.args.staked).to.equal(
        pirexUnlockableCvxTokensBeforeWithdraw.sub(
          userPirexCvxTokensBeforeWithdraw
        )
      );
      expect(pirexStakedCvxTokensAfterWithdraw).to.equal(
        pirexStakedCvxTokensBeforeWithdraw.add(
          pirexUnlockableCvxTokensBeforeWithdraw.sub(
            userPirexCvxTokensBeforeWithdraw
          )
        )
      );
    });

    it('Should revert if msg.sender does not have tokens for epoch', async () => {
      await expect(
        pirexCvx
          .connect(notAdmin)
          .withdraw(firstDepositEpoch, defaultSpendRatio)
      ).to.be.revertedWith('Msg.sender does not have lockedCVX for epoch');
    });

    it('Should withdraw CVX if after lock expiry (second epoch deposit)', async () => {
      const { token } = await pirexCvx.deposits(secondDepositEpoch);
      const pirexCvxToken = await getPirexCvxToken(token);
      const userPirexCvxTokensBeforeWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensBeforeWithdraw = await cvx.balanceOf(admin.address);

      // There should not be any unlockable tokens since we unlocked them all
      const { unlockable: pirexUnlockableCvxTokensBeforeWithdraw } =
        await cvxLocker.lockedBalances(pirexCvx.address);

      // Staked tokens will need to be unstaked to complete deposit
      const pirexStakedCvxTokensBeforeWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      await pirexCvxToken.approve(
        pirexCvx.address,
        userPirexCvxTokensBeforeWithdraw
      );
      await pirexCvx.withdraw(secondDepositEpoch, defaultSpendRatio);

      const userPirexCvxTokensAfterWithdraw = await pirexCvxToken.balanceOf(
        admin.address
      );
      const userCvxTokensAfterWithdraw = await cvx.balanceOf(admin.address);
      const pirexStakedCvxTokensAfterWithdraw = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(pirexUnlockableCvxTokensBeforeWithdraw).to.equal(0);
      expect(userPirexCvxTokensAfterWithdraw).to.equal(0);
      expect(userCvxTokensAfterWithdraw).to.equal(
        userCvxTokensBeforeWithdraw.add(userPirexCvxTokensBeforeWithdraw)
      );
      expect(pirexStakedCvxTokensAfterWithdraw).to.equal(
        pirexStakedCvxTokensBeforeWithdraw.add(
          pirexUnlockableCvxTokensBeforeWithdraw.sub(
            userPirexCvxTokensBeforeWithdraw
          )
        )
      );
    });
  });

  describe('stake', () => {
    it('Should revert if amount is 0', async () => {
      await expect(pirexCvx.stakeCvx(0)).to.be.revertedWith('Invalid amount');
    });

    it('Should revert if amount is greater than balance', async () => {
      await expect(pirexCvx.stakeCvx(`${1e18}`)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('Should stake unlocked CVX', async () => {
      const depositAmount = toBN(1e18);
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const lockDuration = convertBigNumberToNumber(
        await pirexCvx.lockDuration()
      );

      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      // Fast forward to after lock expiry
      await increaseBlockTimestamp(epochDepositDuration + lockDuration);

      const { unlockable } = await cvxLocker.lockedBalances(pirexCvx.address);

      await pirexCvx.unlockCvx(defaultSpendRatio);

      const pirexStakedCvxTokensBefore = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensBeforeStaking = await cvx.balanceOf(pirexCvx.address);
      const stakeEvent = await callAndReturnEvent(pirexCvx.stakeCvx, [
        depositAmount,
      ]);
      const pirexStakedCvxTokensAfter = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(pirexStakedCvxTokensAfter).to.equal(
        pirexStakedCvxTokensBefore.add(unlockable)
      );
      expect(stakeEvent.eventSignature).to.equal('Staked(uint256)');
      expect(stakeEvent.args.amount).to.equal(pirexCvxTokensBeforeStaking);
    });
  });

  describe('unstake', () => {
    it('Should revert if amount to unstake is 0', async () => {
      await expect(pirexCvx.unstakeCvx(0)).to.be.revertedWith('Invalid amount');
    });

    it('Should unstake a specified amount of staked CVX', async () => {
      const pirexStakedCvxTokensBeforeUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );
      const pirexCvxTokensBeforeUnstaking = await cvx.balanceOf(
        pirexCvx.address
      );

      // Transfer half in order to test unstaking only the specified amount
      const unstakeAmount = (
        await cvxRewardPool.balanceOf(pirexCvx.address)
      ).div(2);
      const unstakeEvent = await callAndReturnEvent(pirexCvx.unstakeCvx, [
        unstakeAmount,
      ]);
      const pirexCvxTokensAfterUnstaking = await cvx.balanceOf(
        pirexCvx.address
      );
      const pirexStakedCvxTokensAfterUnstaking = await cvxRewardPool.balanceOf(
        pirexCvx.address
      );

      expect(unstakeAmount.gt(0)).to.equal(true);
      expect(pirexStakedCvxTokensAfterUnstaking).to.equal(
        pirexStakedCvxTokensBeforeUnstaking.sub(unstakeAmount)
      );
      expect(pirexCvxTokensAfterUnstaking).to.equal(
        pirexCvxTokensBeforeUnstaking.add(unstakeAmount)
      );
      expect(unstakeEvent.eventSignature).to.equal('Unstaked(uint256)');
      expect(unstakeEvent.args.amount).to.equal(unstakeAmount);
    });
  });

  describe('claimVotiumReward', () => {
    it('Should enable claim by admin', async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);
      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(pirexCvx.address);

      const pirexRewardTokensBeforeClaim = await rewardToken.balanceOf(
        pirexCvx.address
      );

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const claimEvent = await callAndReturnEvent(pirexCvx.claimVotiumReward, [
        rewardToken.address,
        claimIndex,
        amount,
        proof,
        firstVoteAndRewardEpoch,
      ]);

      const pirexRewardTokensAfterClaim = await rewardToken.balanceOf(
        pirexCvx.address
      );
      const epochReward = await pirexCvx.voteEpochRewards(
        firstVoteAndRewardEpoch,
        0
      );
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstVoteAndRewardEpoch,
        claimEvent.args.voteEpochRewardsIndex
      );

      expect(pirexRewardTokensAfterClaim).to.eq(
        pirexRewardTokensBeforeClaim.add(amount)
      );
      expect(claimEvent.eventSignature).to.equal(
        'VotiumRewardClaimed(address,uint256,uint256,bytes32[],uint256,uint256,address,address,uint256)'
      );
      expect(claimEvent.args.token).to.equal(rewardToken.address);
      expect(claimEvent.args.amount).to.equal(amount);
      expect(claimEvent.args.index).to.equal(claimIndex);
      expect(claimEvent.args.voteEpoch).to.equal(firstVoteAndRewardEpoch);
      expect(claimEvent.args.managerToken).to.equal(zeroAddress);
      expect(claimEvent.args.managerTokenAmount).to.equal(0);
      expect(epochReward.token).to.equal(rewardToken.address);
      expect(epochReward.amount).to.equal(amount);
      expect(voteEpochRewards.token).to.equal(claimEvent.args.token);
      expect(voteEpochRewards.amount).to.equal(claimEvent.args.amount);
    });

    it('Should revert if the parameters are invalid', async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);
      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(pirexCvx.address);

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const invalidEpoch = 0;
      const futureEpoch = (await pirexCvx.getCurrentEpoch()).add(
        await pirexCvx.epochDepositDuration()
      );
      const validEpoch = firstVoteAndRewardEpoch;
      const invalidToken = zeroAddress;
      const invalidIndex = claimIndex + 1;
      const invalidAmount = amount.mul(2);

      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          amount,
          proof,
          invalidEpoch
        )
      ).to.be.revertedWith('Invalid voteEpoch');
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          amount,
          proof,
          futureEpoch
        )
      ).to.be.revertedWith('voteEpoch must be previous epoch');
      await expect(
        pirexCvx.claimVotiumReward(
          invalidToken,
          claimIndex,
          amount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith('frozen');
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          invalidIndex,
          amount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith('Invalid proof.');
      await expect(
        pirexCvx.claimVotiumReward(
          rewardToken.address,
          claimIndex,
          invalidAmount,
          proof,
          validEpoch
        )
      ).to.be.revertedWith('Invalid proof.');
    });

    it('Should allow a VotiumRewardManager contract to swap its reward tokens for CVX', async () => {
      // Set the test merkle root and mint reward token to the multiMerkleStash
      const amount = toBN(1e18);
      const claimIndex = 0;
      const tree = new BalanceTree([
        { account: pirexCvx.address, amount: amount },
      ]);

      await multiMerkleStash
        .connect(votiumOwner)
        .updateMerkleRoot(rewardToken.address, tree.getHexRoot());
      await rewardToken.mint(multiMerkleStash.address, amount);
      await pirexCvx.setVotiumRewardManager(votiumRewardManager.address);
      await cvx.mint(votiumRewardManager.address, amount);

      const proof = tree.getProof(claimIndex, pirexCvx.address, amount);
      const pirexCvxTokensBeforeClaim = await cvx.balanceOf(pirexCvx.address);
      const claimEvent = await callAndReturnEvent(pirexCvx.claimVotiumReward, [
        rewardToken.address,
        claimIndex,
        amount,
        proof,
        firstVoteAndRewardEpoch,
      ]);
      const pirexCvxTokensAfterClaim = await cvx.balanceOf(pirexCvx.address);
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstVoteAndRewardEpoch,
        claimEvent.args.voteEpochRewardsIndex
      );

      expect(pirexCvxTokensAfterClaim).to.equal(
        pirexCvxTokensBeforeClaim.add(claimEvent.args.managerTokenAmount)
      );
      expect(claimEvent.args.token).to.not.equal(claimEvent.args.managerToken);
      expect(claimEvent.args.manager).to.equal(votiumRewardManager.address);
      expect(claimEvent.args.managerToken).to.equal(cvx.address);
      expect(claimEvent.args.managerToken).to.equal(voteEpochRewards.token);
      expect(claimEvent.args.managerTokenAmount).to.equal(amount);
    });
  });

  describe('claimVoteEpochRewards', () => {
    it('Should claim the correct vote epoch rewards for notAdmin', async () => {
      const voteCvx = await getPirexCvxToken(
        await pirexCvx.voteEpochs(firstVoteAndRewardEpoch)
      );
      const adminVoteCvxTokensBeforeTransfer = await voteCvx.balanceOf(
        admin.address
      );
      const voteEpochRewardsLengthArray = Array.from(Array(2).keys());

      // Send voteCvx tokens to notAdmin to test partial claim
      await voteCvx.transfer(
        notAdmin.address,
        adminVoteCvxTokensBeforeTransfer.div(10)
      );

      const adminVoteCvxTokensAfterTransfer = await voteCvx.balanceOf(
        admin.address
      );
      const notAdminVoteCvxTokensAfterTransfer = await voteCvx.balanceOf(
        notAdmin.address
      );
      const voteCvxSupplyBeforeClaim = await voteCvx.totalSupply();
      const voteEpochRewardsBeforeClaim = await Promise.map(
        voteEpochRewardsLengthArray,
        async (_, idx) =>
          await pirexCvx.voteEpochRewards(firstVoteAndRewardEpoch, idx)
      );
      const notAdminRewardTokenBalancesBeforeClaim = await Promise.map(
        voteEpochRewardsBeforeClaim,
        async ({ token }: { token: string }) => {
          const tokenContract = await ethers.getContractAt(
            '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
            token
          );

          return tokenContract.balanceOf(notAdmin.address);
        }
      );

      await voteCvx
        .connect(notAdmin)
        .increaseAllowance(
          pirexCvx.address,
          notAdminVoteCvxTokensAfterTransfer
        );

      const claimVoteEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.connect(notAdmin).claimVoteEpochRewards,
        [firstVoteAndRewardEpoch]
      );
      // const voteCvxSupplyBeforeClaim = await voteCvx.totalSupply();
      const expectedRewardTokens = voteEpochRewardsBeforeClaim.map(
        ({ token }) => token
      );
      const expectedRewardAmounts = voteEpochRewardsBeforeClaim.map(
        ({ amount }) =>
          amount
            .mul(notAdminVoteCvxTokensAfterTransfer)
            .div(voteCvxSupplyBeforeClaim)
      );
      const expectedRewardAmountsAfterClaim = expectedRewardAmounts.map(
        (claimedAmount, idx) =>
          voteEpochRewardsBeforeClaim[idx].amount.sub(claimedAmount)
      );
      const voteCvxSupplyAfterClaim = await voteCvx.totalSupply();
      const notAdminRewardTokenBalanceIncreasesAfterClaim = await Promise.map(
        claimVoteEpochRewardsEvent.args.tokens,
        async (token: string, idx) => {
          const tokenContract = await ethers.getContractAt(
            '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
            token
          );

          return (await tokenContract.balanceOf(notAdmin.address)).sub(
            notAdminRewardTokenBalancesBeforeClaim[idx]
          );
        }
      );

      expect(notAdminVoteCvxTokensAfterTransfer).to.equal(
        adminVoteCvxTokensBeforeTransfer.sub(adminVoteCvxTokensAfterTransfer)
      );
      expect(voteCvxSupplyAfterClaim).to.equal(
        voteCvxSupplyBeforeClaim.sub(notAdminVoteCvxTokensAfterTransfer)
      );
      expect(claimVoteEpochRewardsEvent.eventSignature).to.equal(
        'VoteEpochRewardsClaimed(address[],uint256[],uint256[])'
      );
      expect(claimVoteEpochRewardsEvent.args.tokens).to.deep.equal(
        expectedRewardTokens
      );
      expect(claimVoteEpochRewardsEvent.args.amounts).to.deep.equal(
        expectedRewardAmounts
      );
      expect(claimVoteEpochRewardsEvent.args.remaining).to.deep.equal(
        expectedRewardAmountsAfterClaim
      );
      expect(notAdminRewardTokenBalanceIncreasesAfterClaim).to.deep.equal(
        claimVoteEpochRewardsEvent.args.amounts
      );
    });

    it('Should claim the correct vote epoch rewards for admin', async () => {
      const voteCvx = await getPirexCvxToken(
        await pirexCvx.voteEpochs(firstVoteAndRewardEpoch)
      );
      const adminVoteCvxTokens = await voteCvx.balanceOf(admin.address);
      const voteCvxSupplyBeforeClaim = await voteCvx.totalSupply();
      const voteEpochRewardsLengthArray = Array.from(Array(2).keys());
      const voteEpochRewardsBeforeClaim = await Promise.map(
        voteEpochRewardsLengthArray,
        async (_, idx) =>
          await pirexCvx.voteEpochRewards(firstVoteAndRewardEpoch, idx)
      );
      const adminRewardTokenBalancesBeforeClaim = await Promise.map(
        voteEpochRewardsBeforeClaim,
        async ({ token }: { token: string }) => {
          const tokenContract = await ethers.getContractAt(
            '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
            token
          );

          return tokenContract.balanceOf(admin.address);
        }
      );

      await voteCvx.increaseAllowance(pirexCvx.address, adminVoteCvxTokens);

      const claimVoteEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.claimVoteEpochRewards,
        [firstVoteAndRewardEpoch]
      );
      const expectedRewardTokens = voteEpochRewardsBeforeClaim.map(
        ({ token }) => token
      );
      const expectedRewardAmounts = voteEpochRewardsBeforeClaim.map(
        ({ amount }) =>
          amount.mul(adminVoteCvxTokens).div(voteCvxSupplyBeforeClaim)
      );
      const expectedRewardAmountsAfterClaim = expectedRewardAmounts.map(
        (claimedAmount, idx) =>
          voteEpochRewardsBeforeClaim[idx].amount.sub(claimedAmount)
      );
      const voteCvxSupplyAfterClaim = await voteCvx.totalSupply();
      const adminRewardTokenBalanceIncreasesAfterClaim = await Promise.map(
        voteEpochRewardsBeforeClaim,
        async ({ token }: { token: string }, idx) => {
          const tokenContract = await ethers.getContractAt(
            '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
            token
          );

          return (await tokenContract.balanceOf(admin.address)).sub(
            adminRewardTokenBalancesBeforeClaim[idx]
          );
        }
      );

      expect(voteCvxSupplyAfterClaim).to.equal(
        voteCvxSupplyBeforeClaim.sub(adminVoteCvxTokens)
      );
      expect(claimVoteEpochRewardsEvent.eventSignature).to.equal(
        'VoteEpochRewardsClaimed(address[],uint256[],uint256[])'
      );
      expect(claimVoteEpochRewardsEvent.args.tokens).to.deep.equal(
        expectedRewardTokens
      );
      expect(claimVoteEpochRewardsEvent.args.amounts).to.deep.equal(
        expectedRewardAmounts
      );
      expect(claimVoteEpochRewardsEvent.args.remaining).to.deep.equal(
        expectedRewardAmountsAfterClaim
      );
      expect(adminRewardTokenBalanceIncreasesAfterClaim).to.deep.equal(
        claimVoteEpochRewardsEvent.args.amounts
      );
    });
  });

  describe('claimAndStakeCvxCrvReward', () => {
    it('Should claim and stake cvxCRV reward', async () => {
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const depositAmount = toBN(1e18);
      const rewardAmount = '10000000000000000000000';

      // Deposit CVX so that PirexCvx is eligible for rewards
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);

      // Mint reward tokens for CvxLocker
      await cvxCrvToken.mint(admin.address, rewardAmount);
      await cvxCrvToken.approve(cvxLocker.address, rewardAmount);
      await cvxLocker.notifyRewardAmount(cvxCrvToken.address, rewardAmount);

      // Fast forward past reward distribution period finish
      await increaseBlockTimestamp(
        convertBigNumberToNumber(epochDepositDuration)
      );

      const [expectedClaim] = await cvxLocker.claimableRewards(
        pirexCvx.address
      );
      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeCvxCrvReward,
        []
      );
      const [claim] = claimEvent.args.claimed;
      const stakedAmount = await baseRewardPool.balanceOf(pirexCvx.address);
      const rewardEpoch = (await pirexCvx.getCurrentEpoch()).add(
        epochDepositDuration
      );
      const getEpochRewardTokens: any = async (
        idx = 0,
        tokens: string[] = []
      ) => {
        try {
          return getEpochRewardTokens(
            idx + 1,
            tokens.concat([await pirexCvx.epochRewardTokens(rewardEpoch, idx)])
          );
        } catch (err) {
          return tokens;
        }
      };
      const epochRewardTokens = await getEpochRewardTokens();
      const epochRewards = await Promise.map(
        epochRewardTokens,
        async (epochRewardToken: string) =>
          await pirexCvx.getEpochReward(rewardEpoch, epochRewardToken)
      );

      expect(claimEvent.eventSignature).to.equal(
        'ClaimAndStakeCvxCrvReward((address,uint256)[])'
      );
      expect(claim.token).to.equal(cvxCrvToken.address);
      expect(claim.token).to.equal(expectedClaim.token);
      expect(claim.amount).to.equal(expectedClaim.amount);
      expect(claim.amount).to.equal(stakedAmount);
      expect(epochRewardTokens.length).to.equal(epochRewards.length);
      expect(epochRewardTokens[0]).to.equal(claim.token);
      expect(epochRewards[0]).to.equal(claim.amount);
    });

    it('Should increase the reward amount without a new token if same epoch', async () => {
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const depositAmount = toBN(1e18);
      const rewardAmount = '10000000000000000000000';

      // Deposit and set up more rewards for PirexCvx
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);
      await cvxCrvToken.mint(admin.address, rewardAmount);
      await cvxCrvToken.approve(cvxLocker.address, rewardAmount);
      await cvxLocker.notifyRewardAmount(cvxCrvToken.address, rewardAmount);

      const { timestamp } = await ethers.provider.getBlock('latest');
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const increaseBy = nextEpoch.sub(timestamp).div(2);
      const onlyEpochRewardToken = await pirexCvx.epochRewardTokens(
        nextEpoch,
        0
      );
      const epochRewardsBeforeClaim = await pirexCvx.getEpochReward(
        nextEpoch,
        onlyEpochRewardToken
      );

      // Fast forward but maintain the same epoch (we want to increase stored reward amount)
      await increaseBlockTimestamp(convertBigNumberToNumber(increaseBy));

      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeCvxCrvReward,
        []
      );
      const epochRewardsAfterClaim = await pirexCvx.getEpochReward(
        nextEpoch,
        onlyEpochRewardToken
      );
      const [claim] = claimEvent.args.claimed;

      // Check that the amounts add up
      expect(epochRewardsBeforeClaim.add(claim.amount)).to.equal(
        epochRewardsAfterClaim
      );

      // There should not be another token
      await expect(pirexCvx.epochRewardTokens(nextEpoch, 1)).to.be.reverted;
    });

    it('Should set reward data for the correct epoch', async () => {
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const depositAmount = toBN(1e18);
      const rewardAmount = '10000000000000000000000';

      // Deposit and set up more rewards for PirexCvx
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);
      await cvxCrvToken.mint(admin.address, rewardAmount);
      await cvxCrvToken.approve(cvxLocker.address, rewardAmount);
      await cvxLocker.notifyRewardAmount(cvxCrvToken.address, rewardAmount);

      // Fast forward to the next epoch to test rewards data storage correctness
      await increaseBlockTimestamp(
        convertBigNumberToNumber(epochDepositDuration)
      );

      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const nextEpoch = currentEpoch.add(epochDepositDuration);
      const currentEpochRewardToken = await pirexCvx.epochRewardTokens(
        currentEpoch,
        0
      );
      const currentEpochRewardsBeforeClaim = await pirexCvx.getEpochReward(
        currentEpoch,
        currentEpochRewardToken
      );
      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeCvxCrvReward,
        []
      );
      const [claim] = claimEvent.args.claimed;
      const currentEpochRewardsAfterClaim = await pirexCvx.getEpochReward(
        currentEpoch,
        currentEpochRewardToken
      );
      const nextEpochRewards = await pirexCvx.getEpochReward(
        nextEpoch,
        await pirexCvx.epochRewardTokens(nextEpoch, 0)
      );

      // Current epoch rewards should not change
      expect(currentEpochRewardsAfterClaim).to.equal(
        currentEpochRewardsBeforeClaim
      );

      // Verify amount set correctly for next epoch
      expect(claim.amount).to.equal(nextEpochRewards);
    });
  });

  describe('claimEpochRewards', () => {
    it('Should claim the correct epoch rewards for notAdmin', async () => {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const rewardCvx = await getPirexCvxToken(
        await pirexCvx.rewardEpochs(currentEpoch)
      );
      const adminRewardCvxTokens = await rewardCvx.balanceOf(admin.address);

      // Transfer 10% of tokens to notAdmin - notAdmin now owns 10% of the supply
      await rewardCvx.transfer(notAdmin.address, adminRewardCvxTokens.div(10));

      const notAdminRewardCvxTokensBeforeClaim = await rewardCvx.balanceOf(
        notAdmin.address
      );

      await rewardCvx
        .connect(notAdmin)
        .increaseAllowance(
          pirexCvx.address,
          notAdminRewardCvxTokensBeforeClaim
        );

      const epochReward = await pirexCvx.getEpochReward(
        currentEpoch,
        cvxCrvToken.address
      );

      // notAdmin has 10% of the rewardCvx for this epoch and should get 10% rewards
      const expectedClaimAmount = epochReward.div(10);

      const expectedRemaining = epochReward.sub(expectedClaimAmount);
      const claimRewardEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.connect(notAdmin).claimEpochRewards,
        [currentEpoch]
      );
      const notAdminRewardCvxTokensAfterClaim = await rewardCvx.balanceOf(
        notAdmin.address
      );

      expect(notAdminRewardCvxTokensAfterClaim).to.equal(0);
      expect(claimRewardEpochRewardsEvent.eventSignature).to.equal(
        'EpochRewardsClaimed(address[],uint256[],uint256[])'
      );
      expect(claimRewardEpochRewardsEvent.args.amounts[0]).to.equal(
        expectedClaimAmount
      );
      expect(claimRewardEpochRewardsEvent.args.tokens[0]).to.equal(
        cvxCrvToken.address
      );
      expect(claimRewardEpochRewardsEvent.args.remaining[0]).to.equal(
        expectedRemaining
      );
    });
  });
});
