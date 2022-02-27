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

describe('PirexCvx: RewardCVX', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;

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

  describe('claimAndStakeEpochRewards', () => {
    it('Should claim rewards and stake cvxCRV', async () => {
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

      const [claimableCrv, claimableCvxCrv] = await cvxLocker.claimableRewards(
        pirexCvx.address
      );
      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeEpochRewards,
        []
      );
      const [crvEventArg, cvxCrvEventArg] = claimEvent.args.claimed;
      const stakedAmount = await baseRewardPool.balanceOf(pirexCvx.address);
      const rewardEpoch = (await pirexCvx.getCurrentEpoch()).add(
        epochDepositDuration
      );

      // Independent from claimEvent data to ensure epoch reward tokens stored as expected
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
        'EpochRewardsClaimedAndStaked((address,uint256)[])'
      );
      expect(crvEventArg.token).to.equal(crv.address);
      expect(cvxCrvEventArg.token).to.equal(cvxCrvToken.address);
      expect(crvEventArg.token).to.equal(claimableCrv.token);
      expect(crvEventArg.amount).to.equal(claimableCrv.amount);
      expect(cvxCrvEventArg.token).to.equal(claimableCvxCrv.token);
      expect(cvxCrvEventArg.amount).to.equal(claimableCvxCrv.amount);
      expect(cvxCrvEventArg.amount).to.equal(stakedAmount);
      expect(epochRewardTokens.length).to.equal(epochRewards.length);
      expect(epochRewardTokens[0]).to.equal(cvxCrvEventArg.token);
      expect(epochRewards[0]).to.equal(cvxCrvEventArg.amount);
    });

    it('Should increase existing reward amounts without modifying epochRewardTokens', async () => {
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
      const cvxCrvRewardToken = await pirexCvx.epochRewardTokens(nextEpoch, 0);
      const cvxCrvRewardsBeforeClaim = await pirexCvx.getEpochReward(
        nextEpoch,
        cvxCrvRewardToken
      );

      // Fast forward but maintain the same epoch (we want to increase stored reward amount)
      await increaseBlockTimestamp(convertBigNumberToNumber(increaseBy));

      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeEpochRewards,
        []
      );
      const cvxCrvRewardsAfterClaim = await pirexCvx.getEpochReward(
        nextEpoch,
        cvxCrvRewardToken
      );
      const [, cvxCrv] = claimEvent.args.claimed;

      // Check that the amounts add up
      expect(cvxCrvRewardsBeforeClaim.add(cvxCrv.amount)).to.equal(
        cvxCrvRewardsAfterClaim
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
      const currentEpochCvxCrvRewardToken = await pirexCvx.epochRewardTokens(
        currentEpoch,
        0
      );
      const currentEpochCvxCrvRewardsBeforeClaim =
        await pirexCvx.getEpochReward(
          currentEpoch,
          currentEpochCvxCrvRewardToken
        );
      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeEpochRewards,
        []
      );
      const [, cvxCrv] = claimEvent.args.claimed;
      const currentEpochCvxCrvRewardsAfterClaim = await pirexCvx.getEpochReward(
        currentEpoch,
        currentEpochCvxCrvRewardToken
      );
      const nextEpochRewards = await pirexCvx.getEpochReward(
        nextEpoch,
        await pirexCvx.epochRewardTokens(nextEpoch, 0)
      );

      // Current epoch rewards should not change
      expect(currentEpochCvxCrvRewardsAfterClaim).to.equal(
        currentEpochCvxCrvRewardsBeforeClaim
      );

      // Verify amount set correctly for next epoch
      expect(cvxCrv.amount).to.equal(nextEpochRewards);
    });

    it('Should set reward data for new claimable reward tokens', async () => {
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const depositAmount = toBN(1e18);
      const crvRewardAmount = '5000000000000000000000';
      const rewardEpoch = (await pirexCvx.getCurrentEpoch()).add(
        epochDepositDuration
      );
      const { timestamp } = await ethers.provider.getBlock('latest');

      // Deposit and set up more rewards for PirexCvx
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, defaultSpendRatio);
      await crv.mint(admin.address, crvRewardAmount);
      await crv.approve(cvxLocker.address, crvRewardAmount);
      await cvxLocker.notifyRewardAmount(crv.address, crvRewardAmount);

      // Fast forward to the next epoch to test rewards data storage correctness
      await increaseBlockTimestamp(
        convertBigNumberToNumber(rewardEpoch.sub(timestamp).div(2))
      );

      const cvxCrvEpochRewardsBeforeClaim = await pirexCvx.getEpochReward(
        rewardEpoch,
        cvxCrvToken.address
      );
      const claimEvent = await callAndReturnEvent(
        pirexCvx.claimAndStakeEpochRewards,
        []
      );
      const [crvEventArg, cvxCrvEventArg] = claimEvent.args.claimed;
      const crvEpochRewards = await pirexCvx.getEpochReward(
        rewardEpoch,
        crv.address
      );
      const cvxCrvEpochRewardsAfterClaim = await pirexCvx.getEpochReward(
        rewardEpoch,
        cvxCrvToken.address
      );

      expect(crvEventArg.token).to.equal(crv.address);
      expect(cvxCrvEventArg.token).to.equal(cvxCrvToken.address);
      expect(crvEventArg.amount).to.equal(crvEpochRewards);
      expect(cvxCrvEventArg.amount).to.equal(0);
      expect(cvxCrvEpochRewardsBeforeClaim).to.equal(
        cvxCrvEpochRewardsAfterClaim
      );
    });
  });

  describe('redeemEpochRewards', () => {
    it('Should redeem the correct epoch rewards for notAdmin', async () => {
      // Fast forward to the next epoch so that we can redeem recently-added CRV
      await increaseBlockTimestamp(
        convertBigNumberToNumber(await pirexCvx.epochDepositDuration())
      );

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

      const crvEpochReward = await pirexCvx.getEpochReward(
        currentEpoch,
        crv.address
      );
      const cvxCrvEpochReward = await pirexCvx.getEpochReward(
        currentEpoch,
        cvxCrvToken.address
      );

      // notAdmin has 10% of the rewardCvx for this epoch and should get 10% rewards
      const expectedCrvClaimAmount = crvEpochReward.div(10);
      const expectedCvxCrvClaimAmount = cvxCrvEpochReward.div(10);

      const expectedCrvRemaining = crvEpochReward.sub(expectedCrvClaimAmount);
      const expectedCvxCrvRemaining = cvxCrvEpochReward.sub(
        expectedCvxCrvClaimAmount
      );
      const notAdminCrvBalanceBeforeClaim = await crv.balanceOf(
        notAdmin.address
      );
      const notAdminCvxCrvBalanceBeforeClaim = await cvxCrvToken.balanceOf(
        notAdmin.address
      );
      const redeemEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.connect(notAdmin).redeemEpochRewards,
        [currentEpoch]
      );
      const notAdminCrvBalanceAfterClaim = await crv.balanceOf(
        notAdmin.address
      );
      const notAdminCvxCrvBalanceAfterClaim = await cvxCrvToken.balanceOf(
        notAdmin.address
      );
      const [claimedCvxCrvRewardToken, claimedCrvRewardToken] =
        redeemEpochRewardsEvent.args.tokens;
      const [claimedCvxCrvRewardAmounts, claimedCrvRewardAmounts] =
        redeemEpochRewardsEvent.args.amounts;
      const [claimedCvxCrvRewardRemaining, claimedCrvRewardRemaining] =
        redeemEpochRewardsEvent.args.remaining;
      const notAdminRewardCvxTokensAfterClaim = await rewardCvx.balanceOf(
        notAdmin.address
      );

      expect(notAdminRewardCvxTokensAfterClaim).to.equal(0);
      expect(redeemEpochRewardsEvent.eventSignature).to.equal(
        'EpochRewardsRedeemed(address[],uint256[],uint256[])'
      );
      expect(claimedCvxCrvRewardToken).to.equal(cvxCrvToken.address);
      expect(claimedCrvRewardToken).to.equal(crv.address);
      expect(claimedCvxCrvRewardAmounts)
        .to.equal(expectedCvxCrvClaimAmount)
        .and.gt(0);
      expect(claimedCrvRewardAmounts)
        .to.equal(expectedCrvClaimAmount)
        .and.gt(0);
      expect(claimedCvxCrvRewardRemaining)
        .to.equal(expectedCvxCrvRemaining)
        .and.gt(0);
      expect(claimedCrvRewardRemaining)
        .to.equal(expectedCrvRemaining)
        .and.gt(0);
      expect(notAdminCrvBalanceAfterClaim)
        .to.equal(notAdminCrvBalanceBeforeClaim.add(expectedCrvClaimAmount))
        .and.gt(0);
      expect(notAdminCvxCrvBalanceAfterClaim)
        .to.equal(
          notAdminCvxCrvBalanceBeforeClaim.add(expectedCvxCrvClaimAmount)
        )
        .and.gt(0);
    });
  });
});
