import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
} from './helpers';
import { BigNumber } from 'ethers';
import {
  ConvexToken,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  CurveVoterProxy,
  CvxStakingProxy,
} from '../typechain-types';

describe('PirexCvx: LockedCVX', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;
  let firstDepositEpoch: BigNumber;
  let secondDepositEpoch: BigNumber;

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

  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const cvxDelegateRegistry = '0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446';
  const votiumMultiMerkleStash = '0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A';
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const lockedCvxPrefix = 'lockedCVX';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const PirexCvx = await ethers.getContractFactory('PirexCvx');

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

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt('ERC20PresetMinterPauserUpgradeable', address);

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
});
