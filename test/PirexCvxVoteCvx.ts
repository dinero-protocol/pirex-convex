import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import {
  callAndReturnEvent,
  toBN,
  impersonateAddressAndReturnSigner,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
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

describe('PirexCvx: VoteCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let votiumOwner: SignerWithAddress;
  let pirexCvx: PirexCvx;
  let votiumRewardManager: VotiumRewardManager;
  let multiMerkleStash: MultiMerkleStash;
  let rewardToken: Cvx;
  let cvxLockerLockDuration: BigNumber;
  let firstVoteEpoch: BigNumber;

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
  const zeroAddress = '0x0000000000000000000000000000000000000000';

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
      baseRewardPool.address,
      cvxCrvToken.address
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
    await cvxLocker.addReward(crv.address, admin.address, true);
    await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
    await cvxStakingProxy.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt('ERC20PresetMinterPauserUpgradeable', address);

  describe('claimVotiumReward', () => {
    it('Should enable claim by admin', async () => {
      const epochDepositDuration = await pirexCvx.epochDepositDuration();
      const depositAmount = toBN(1e18);

      firstVoteEpoch = (await pirexCvx.getCurrentEpoch()).add(
        epochDepositDuration
      );

      // Deposit CVX so that PirexCvx is eligible for rewards
      await cvx.approve(pirexCvx.address, depositAmount);
      await pirexCvx.deposit(depositAmount, 0);

      // Fast forward two epochs so we can burn voteCVX for bribes
      await increaseBlockTimestamp(
        convertBigNumberToNumber(epochDepositDuration.mul(2))
      );

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
        firstVoteEpoch,
      ]);
      const pirexRewardTokensAfterClaim = await rewardToken.balanceOf(
        pirexCvx.address
      );
      const epochReward = await pirexCvx.voteEpochRewards(firstVoteEpoch, 0);
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstVoteEpoch,
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
      expect(claimEvent.args.voteEpoch).to.equal(firstVoteEpoch);
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
      const validEpoch = firstVoteEpoch;
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
        firstVoteEpoch,
      ]);
      const pirexCvxTokensAfterClaim = await cvx.balanceOf(pirexCvx.address);
      const voteEpochRewards = await pirexCvx.voteEpochRewards(
        firstVoteEpoch,
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

  describe('redeemVoteEpochRewards', () => {
    it('Should claim the correct vote epoch rewards for notAdmin', async () => {
      const voteCvx = await getPirexCvxToken(
        await pirexCvx.voteEpochs(firstVoteEpoch)
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
        async (_, idx) => await pirexCvx.voteEpochRewards(firstVoteEpoch, idx)
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

      const redeemVoteEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.connect(notAdmin).redeemVoteEpochRewards,
        [firstVoteEpoch]
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
        redeemVoteEpochRewardsEvent.args.tokens,
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
      expect(redeemVoteEpochRewardsEvent.eventSignature).to.equal(
        'VoteEpochRewardsRedeemed(address[],uint256[],uint256[])'
      );
      expect(redeemVoteEpochRewardsEvent.args.tokens).to.deep.equal(
        expectedRewardTokens
      );
      expect(redeemVoteEpochRewardsEvent.args.amounts).to.deep.equal(
        expectedRewardAmounts
      );
      expect(redeemVoteEpochRewardsEvent.args.remaining).to.deep.equal(
        expectedRewardAmountsAfterClaim
      );
      expect(notAdminRewardTokenBalanceIncreasesAfterClaim).to.deep.equal(
        redeemVoteEpochRewardsEvent.args.amounts
      );
    });

    it('Should claim the correct vote epoch rewards for admin', async () => {
      const voteCvx = await getPirexCvxToken(
        await pirexCvx.voteEpochs(firstVoteEpoch)
      );
      const adminVoteCvxTokens = await voteCvx.balanceOf(admin.address);
      const voteCvxSupplyBeforeClaim = await voteCvx.totalSupply();
      const voteEpochRewardsLengthArray = Array.from(Array(2).keys());
      const voteEpochRewardsBeforeClaim = await Promise.map(
        voteEpochRewardsLengthArray,
        async (_, idx) => await pirexCvx.voteEpochRewards(firstVoteEpoch, idx)
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

      const redeemVoteEpochRewardsEvent = await callAndReturnEvent(
        pirexCvx.redeemVoteEpochRewards,
        [firstVoteEpoch]
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
      expect(redeemVoteEpochRewardsEvent.eventSignature).to.equal(
        'VoteEpochRewardsRedeemed(address[],uint256[],uint256[])'
      );
      expect(redeemVoteEpochRewardsEvent.args.tokens).to.deep.equal(
        expectedRewardTokens
      );
      expect(redeemVoteEpochRewardsEvent.args.amounts).to.deep.equal(
        expectedRewardAmounts
      );
      expect(redeemVoteEpochRewardsEvent.args.remaining).to.deep.equal(
        expectedRewardAmountsAfterClaim
      );
      expect(adminRewardTokenBalanceIncreasesAfterClaim).to.deep.equal(
        redeemVoteEpochRewardsEvent.args.amounts
      );
    });
  });
});
