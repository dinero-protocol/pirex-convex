import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import {
  callAndReturnEvents,
  toBN,
  increaseBlockTimestamp,
  validateEvent,
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
} from '../typechain-types';
import { BalanceTree } from '../lib/merkle';

// Tests the rewards related logic
describe('PirexCvx-Reward', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let cvx: ConvexToken;
  let crv: Crv;
  let cvxCrvToken: any;
  let cvxLocker: CvxLocker;
  let votiumMultiMerkleStash: MultiMerkleStash;

  let zeroAddress: string;
  let feeDenominator: number;
  let feePercentDenominator: number;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      treasury,
      contributors,
      cvx,
      crv,
      cvxCrvToken,
      cvxLocker,
      votiumMultiMerkleStash,
      pirexFees,
      pCvx,
      feePercentDenominator,
      feeDenominator,
      zeroAddress,
      epochDuration,
      futuresEnum,
      feesEnum,
    } = this);
  });

  describe('takeEpochSnapshot', function () {
    before(async function () {
      const crvRewardAmount = toBN(5e18);
      const cvxCrvRewardAmount = toBN(10e18);

      await crv.approve(cvxLocker.address, crvRewardAmount);
      await cvxCrvToken.approve(cvxLocker.address, cvxCrvRewardAmount);
      await cvxLocker.notifyRewardAmount(crv.address, crvRewardAmount);
      await cvxLocker.notifyRewardAmount(
        cvxCrvToken.address,
        cvxCrvRewardAmount
      );

      // Increase time to accrue rewards
      await increaseBlockTimestamp(10000);
    });

    it('Should not allow claimVotiumReward to be called if maintenance has not been performed', async function () {
      const { snapshotId } = await pCvx.getEpoch(await pCvx.getCurrentEpoch());
      const token = cvx.address;
      const index = 0;
      const amount = toBN(1e18);
      const proof = new BalanceTree([
        { amount, account: admin.address },
      ]).getProof(index, admin.address, amount);

      expect(snapshotId).to.equal(0);
      await expect(
        pCvx.claimVotiumReward(token, index, amount, proof)
      ).to.be.revertedWith('SnapshotRequired()');
    });

    it('Should take a snapshot', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const epochBefore = await pCvx.getEpoch(currentEpoch);
      const snapshotIdBefore = await pCvx.getCurrentSnapshotId();
      const events = await callAndReturnEvents(pCvx.takeEpochSnapshot, []);
      const snapshotEvent = events[0];
      const epochAfter = await pCvx.getEpoch(currentEpoch);
      const snapshotIdAfter = await pCvx.getCurrentSnapshotId();

      expect(epochBefore.snapshotId).to.equal(0);
      expect(epochAfter.snapshotId).to.equal(snapshotIdAfter);
      expect(snapshotIdAfter).to.not.equal(snapshotIdBefore);
      expect(snapshotIdAfter).to.equal(snapshotIdBefore.add(1));
      validateEvent(snapshotEvent, 'Snapshot(uint256)', {
        id: snapshotIdAfter,
      });
    });
  });

  describe('claimVotiumReward', function () {
    let cvxRewardDistribution: { account: string; amount: BigNumber }[];
    let crvRewardDistribution: { account: string; amount: BigNumber }[];
    let cvxTree: BalanceTree;
    let crvTree: BalanceTree;

    before(async function () {
      cvxRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(1e18),
        },
      ];
      crvRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(2e18),
        },
      ];
      cvxTree = new BalanceTree(cvxRewardDistribution);
      crvTree = new BalanceTree(crvRewardDistribution);

      const token1 = cvx.address;
      const token2 = crv.address;

      await cvx.transfer(votiumMultiMerkleStash.address, toBN(1e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        token1,
        cvxTree.getHexRoot()
      );

      await crv.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        token2,
        crvTree.getHexRoot()
      );
    });

    it('Should revert if token is zero address', async function () {
      const invalidToken = zeroAddress;
      const index = 0;
      const account = pCvx.address;
      const amount = cvxRewardDistribution[0].amount;
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(invalidToken, index, amount, proof)
      ).to.be.revertedWith(
        'Transaction reverted: function returned an unexpected amount of data'
      );
    });

    it('Should revert if index is invalid', async function () {
      const token = cvx.address;
      const invalidIndex = 10;
      const index = 0; // Used to generate a valid proof
      const account = pCvx.address;
      const amount = cvxRewardDistribution[0].amount;
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(token, invalidIndex, amount, proof)
      ).to.be.revertedWith(
        `VM Exception while processing transaction: reverted with reason string 'Invalid proof.'`
      );
    });

    it('Should revert if amount is zero', async function () {
      const token = cvx.address;
      const index = 0;
      const account = pCvx.address;
      const invalidAmount = toBN(100e18);
      const amount = cvxRewardDistribution[0].amount; // Used to generate a valid proof
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(token, index, invalidAmount, proof)
      ).to.be.revertedWith(
        `VM Exception while processing transaction: reverted with reason string 'Invalid proof.'`
      );
    });

    it('Should claim Votium rewards and set distribution for pCVX and rpCVX token holders', async function () {
      const tokens = [cvx.address, crv.address];
      const index = 0;
      const account = pCvx.address;
      const amounts = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const trees = [
        cvxTree.getProof(index, account, amounts[0]),
        crvTree.getProof(index, account, amounts[1]),
      ];
      const snapshotSupply = await pCvx.totalSupply();
      const currentEpoch = await pCvx.getCurrentEpoch();
      const epochRpCvxSupply = await (
        await this.getRpCvx(await pCvx.rpCvx())
      ).totalSupply(currentEpoch);
      const rewardFee = await pCvx.fees(feesEnum.reward);
      const cvxFee = amounts[0].mul(rewardFee).div(feeDenominator);
      const crvFee = amounts[1].mul(rewardFee).div(feeDenominator);
      const treasuryCvxBalanceBefore = await cvx.balanceOf(treasury.address);
      const contributorsCvxBalanceBefore = await cvx.balanceOf(
        contributors.address
      );
      const treasuryCrvBalanceBefore = await crv.balanceOf(treasury.address);
      const contributorsCrvBalanceBefore = await crv.balanceOf(
        contributors.address
      );
      const cvxClaimEvents = await callAndReturnEvents(pCvx.claimVotiumReward, [
        tokens[0],
        index,
        amounts[0],
        trees[0],
      ]);
      const crvClaimEvents = await callAndReturnEvents(pCvx.claimVotiumReward, [
        tokens[1],
        index,
        amounts[1],
        trees[1],
      ]);
      const cvxClaimEvent = cvxClaimEvents[0];
      const crvClaimEvent = crvClaimEvents[0];
      const epoch = await pCvx.getEpoch(currentEpoch);
      const { snapshotRewards, futuresRewards } = await pCvx.getEpoch(
        currentEpoch
      );
      const votiumSnapshotRewards = snapshotRewards;
      const votiumFuturesRewards = futuresRewards;
      const expectedVotiumSnapshotRewards = {
        amounts: amounts.map((amount: BigNumber) => {
          const rewards = amount
            .mul(toBN(feeDenominator).sub(rewardFee))
            .div(feeDenominator);

          return rewards
            .mul(snapshotSupply)
            .div(snapshotSupply.add(epochRpCvxSupply));
        }),
      };
      const expectedVotiumFuturesRewards = {
        amounts: amounts.map((amount: BigNumber, idx: number) => {
          const rewards = amount
            .mul(toBN(feeDenominator).sub(rewardFee))
            .div(feeDenominator);

          return rewards.sub(expectedVotiumSnapshotRewards.amounts[idx]);
        }),
      };
      const treasuryCvxBalanceAfter = await cvx.balanceOf(treasury.address);
      const contributorsCvxBalanceAfter = await cvx.balanceOf(
        contributors.address
      );
      const treasuryCrvBalanceAfter = await crv.balanceOf(treasury.address);
      const contributorsCrvBalanceAfter = await crv.balanceOf(
        contributors.address
      );
      const treasuryPercent = await pirexFees.treasuryPercent();
      const contributorsPercent = await pirexFees.contributorsPercent();
      const expectedTreasuryCvxFees = cvxFee
        .mul(treasuryPercent)
        .div(feePercentDenominator);
      const expectedContributorsCvxFees = cvxFee
        .mul(contributorsPercent)
        .div(feePercentDenominator);
      const expectedTreasuryCrvFees = crvFee
        .mul(treasuryPercent)
        .div(feePercentDenominator);
      const expectedContributorsCrvFees = crvFee
        .mul(contributorsPercent)
        .div(feePercentDenominator);

      expect(epoch.rewards.includes(tokens[0])).to.equal(true);
      expect(epoch.rewards.includes(tokens[1])).to.equal(true);
      expect(votiumSnapshotRewards).to.deep.equal(
        expectedVotiumSnapshotRewards.amounts
      );
      expect(votiumFuturesRewards).to.deep.equal(
        expectedVotiumFuturesRewards.amounts
      );
      expect(treasuryCvxBalanceAfter).to.not.equal(treasuryCvxBalanceBefore);
      expect(treasuryCvxBalanceAfter).to.equal(
        treasuryCvxBalanceBefore.add(expectedTreasuryCvxFees)
      );
      expect(contributorsCvxBalanceAfter).to.not.equal(
        contributorsCvxBalanceBefore
      );
      expect(contributorsCvxBalanceAfter).to.equal(
        contributorsCvxBalanceBefore.add(expectedContributorsCvxFees)
      );
      expect(treasuryCrvBalanceAfter).to.not.equal(treasuryCrvBalanceBefore);
      expect(treasuryCrvBalanceAfter).to.equal(
        treasuryCrvBalanceBefore.add(expectedTreasuryCrvFees)
      );
      expect(contributorsCrvBalanceAfter).to.not.equal(
        contributorsCrvBalanceBefore
      );
      expect(contributorsCrvBalanceAfter).to.equal(
        contributorsCrvBalanceBefore.add(expectedContributorsCrvFees)
      );
      validateEvent(
        cvxClaimEvent,
        'ClaimVotiumReward(address,uint256,uint256)',
        {
          token: tokens[0],
          index,
          amount: amounts[0],
        }
      );
      validateEvent(
        crvClaimEvent,
        'ClaimVotiumReward(address,uint256,uint256)',
        {
          token: tokens[1],
          index,
          amount: amounts[1],
        }
      );
    });
  });

  describe('claimMiscRewards', function () {
    it('Should claim misc rewards for the epoch', async function () {
      const treasuryCrvBalanceBefore = await crv.balanceOf(treasury.address);
      const contributorsCrvBalanceBefore = await crv.balanceOf(
        contributors.address
      );
      const treasuryCvxCrvBalanceBefore = await cvxCrvToken.balanceOf(
        treasury.address
      );
      const contributorsCvxCrvBalanceBefore = await cvxCrvToken.balanceOf(
        contributors.address
      );
      const [claimableCrv, claimableCvxCrv] = await cvxLocker.claimableRewards(
        pCvx.address
      );
      const events = await callAndReturnEvents(pCvx.claimMiscRewards, []);
      const claimEvent = events[0];
      const treasuryCrvBalanceAfter = await crv.balanceOf(treasury.address);
      const contributorsCrvBalanceAfter = await crv.balanceOf(
        contributors.address
      );
      const treasuryCvxCrvBalanceAfter = await cvxCrvToken.balanceOf(
        treasury.address
      );
      const contributorsCvxCrvBalanceAfter = await cvxCrvToken.balanceOf(
        contributors.address
      );
      const treasuryPercent = await pirexFees.treasuryPercent();
      const contributorsPercent = await pirexFees.contributorsPercent();
      const expectedTreasuryCrvFees = claimableCrv.amount
        .mul(treasuryPercent)
        .div(feePercentDenominator);
      const expectedContributorsCrvFees = claimableCrv.amount
        .mul(contributorsPercent)
        .div(feePercentDenominator);
      const expectedTreasuryCvxCrvFees = claimableCvxCrv.amount
        .mul(treasuryPercent)
        .div(feePercentDenominator);
      const expectedContributorsCvxCrvFees = claimableCvxCrv.amount
        .mul(contributorsPercent)
        .div(feePercentDenominator);

      expect(treasuryCrvBalanceAfter).to.not.equal(treasuryCrvBalanceBefore);
      expect(
        treasuryCrvBalanceAfter.gt(
          treasuryCrvBalanceBefore.add(expectedTreasuryCrvFees)
        )
      ).to.be.equal(true);
      expect(
        treasuryCrvBalanceAfter.lt(
          treasuryCrvBalanceBefore
            .add(expectedTreasuryCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(contributorsCrvBalanceAfter).to.not.equal(
        contributorsCrvBalanceBefore
      );
      expect(
        contributorsCrvBalanceAfter.gt(
          contributorsCrvBalanceBefore.add(expectedContributorsCrvFees)
        )
      ).to.equal(true);
      expect(
        contributorsCrvBalanceAfter.lt(
          contributorsCrvBalanceBefore
            .add(expectedContributorsCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(treasuryCvxCrvBalanceAfter).to.not.equal(
        treasuryCvxCrvBalanceBefore
      );
      expect(
        treasuryCvxCrvBalanceAfter.gt(
          treasuryCvxCrvBalanceBefore.add(expectedTreasuryCvxCrvFees)
        )
      ).to.equal(true);
      expect(
        treasuryCvxCrvBalanceAfter.lt(
          treasuryCvxCrvBalanceBefore
            .add(expectedTreasuryCvxCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(contributorsCvxCrvBalanceAfter).to.not.equal(
        contributorsCvxCrvBalanceBefore
      );
      expect(
        contributorsCvxCrvBalanceAfter.gt(
          contributorsCvxCrvBalanceBefore.add(expectedContributorsCvxCrvFees)
        )
      ).to.equal(true);
      expect(
        contributorsCvxCrvBalanceAfter.lt(
          contributorsCvxCrvBalanceBefore
            .add(expectedContributorsCvxCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      validateEvent(
        claimEvent,
        'ClaimMiscRewards(uint256,(address,uint256,uint256)[])',
        {}
      );
    });
  });

  describe('redeemSnapshotReward', function () {
    it('Should revert if epoch is zero', async function () {
      const invalidEpoch = 0;
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(invalidEpoch, rewardIndex, to)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if rewardIndex is invalid', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidRewardIndex = 5;
      const to = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(epoch, invalidRewardIndex, to)
      ).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)'
      );
    });

    it('Should revert if to is zero address', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const invalidTo = zeroAddress;

      await expect(
        pCvx.redeemSnapshotReward(epoch, rewardIndex, invalidTo)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should revert if msg.sender has an insufficient balance', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).redeemSnapshotReward(epoch, rewardIndex, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('Should redeem snapshot reward', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId, snapshotRewards } = await pCvx.getEpoch(currentEpoch);
      const snapshotBalance = await pCvx.balanceOfAt(admin.address, snapshotId);
      const snapshotSupply = await pCvx.totalSupplyAt(snapshotId);
      const to = admin.address;
      const [cvxEvent] = await callAndReturnEvents(pCvx.redeemSnapshotReward, [
        currentEpoch,
        0,
        to,
      ]);
      const [crvEvent] = await callAndReturnEvents(pCvx.redeemSnapshotReward, [
        currentEpoch,
        1,
        to,
      ]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const expectedCvxRewards = snapshotRewards[0]
        .mul(snapshotBalance)
        .div(snapshotSupply);
      const expectedCrvRewards = snapshotRewards[1]
        .mul(snapshotBalance)
        .div(snapshotSupply);

      validateEvent(
        cvxEvent,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch: currentEpoch,
          to: admin.address,
          snapshotId,
          snapshotBalance,
          rewardIndex: 0,
          redeemAmount: expectedCvxRewards,
        }
      );
      validateEvent(
        crvEvent,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch: currentEpoch,
          to: admin.address,
          snapshotId,
          snapshotBalance,
          rewardIndex: 1,
          redeemAmount: expectedCrvRewards,
        }
      );

      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(expectedCrvRewards)
      );
    });

    it('Should revert if msg.sender has already redeemed', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(epoch, rewardIndex, to)
      ).to.be.revertedWith('AlreadyRedeemed()');
    });
  });

  describe('redeemFuturesRewards', function () {
    it('Should revert if epoch is zero', async function () {
      const invalidEpoch = 0;
      const to = admin.address;

      await expect(
        pCvx.redeemFuturesRewards(invalidEpoch, to)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if to is zero address', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidTo = zeroAddress;
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());

      await rpCvx.setApprovalForAll(pCvx.address, true);

      await expect(
        pCvx.redeemFuturesRewards(epoch, invalidTo)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should revert if msg.sender has an insufficient balance', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).redeemFuturesRewards(epoch, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('Should redeem futures reward', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;
      const rpCvx = await ethers.getContractAt(
        'ERC1155PresetMinterSupply',
        await pCvx.rpCvx()
      );

      // Transfer half to test correctness for partial reward redemptions
      await rpCvx.safeTransferFrom(
        admin.address,
        notAdmin.address,
        epoch,
        (await rpCvx.balanceOf(admin.address, epoch)).div(2),
        ethers.utils.formatBytes32String('')
      );

      const rpCvxBalanceBefore = await rpCvx.balanceOf(admin.address, epoch);
      const rpCvxSupplyBefore = await rpCvx.totalSupply(epoch);

      await rpCvx.setApprovalForAll(pCvx.address, true);

      const events = await callAndReturnEvents(pCvx.redeemFuturesRewards, [
        epoch,
        to,
      ]);
      const redeemEvent = events[0];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const rpCvxBalanceAfter = await rpCvx.balanceOf(admin.address, epoch);
      const rpCvxSupplyAfter = await rpCvx.totalSupply(epoch);
      const { rewards, futuresRewards } = await pCvx.getEpoch(epoch);
      const expectedClaimAmounts = futuresRewards.map((amount: BigNumber) =>
        amount.mul(rpCvxBalanceBefore).div(rpCvxSupplyBefore)
      );

      expect(rpCvxBalanceAfter).to.not.equal(rpCvxBalanceBefore);
      expect(rpCvxBalanceAfter).to.equal(0);
      expect(rpCvxSupplyAfter).to.not.equal(rpCvxSupplyBefore);
      expect(rpCvxSupplyAfter).to.equal(
        rpCvxSupplyBefore.sub(rpCvxBalanceBefore)
      );
      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedClaimAmounts[0])
      );
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(expectedClaimAmounts[1])
      );
      validateEvent(
        redeemEvent,
        'RedeemFuturesRewards(uint256,address,address[])',
        {
          epoch,
          to,
          rewards,
        }
      );
    });
  });

  describe('exchangeFutures', function () {
    before(async function () {
      const depositAmount = toBN(1e18);
      const stakeRounds = 1;

      await cvx.approve(pCvx.address, depositAmount);
      await pCvx.deposit(admin.address, depositAmount, true);
      await pCvx.stake(
        stakeRounds,
        futuresEnum.reward,
        admin.address,
        depositAmount
      );
    });

    it('Should revert if epoch is current', async function () {
      const invalidEpoch1 = await pCvx.getCurrentEpoch();
      const invalidEpoch2 = invalidEpoch1.sub(epochDuration);
      const to = admin.address;
      const amount = toBN(1e18);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(invalidEpoch1, to, amount, i, o)
      ).to.be.revertedWith('PastExchangePeriod()');
      await expect(
        pCvx.exchangeFutures(invalidEpoch2, to, amount, i, o)
      ).to.be.revertedWith('PastExchangePeriod()');
    });

    it('Should revert if amount is zero', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const to = admin.address;
      const invalidAmount = 0;
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(epoch, to, invalidAmount, i, o)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if sender balance is insufficient', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());
      const sender = notAdmin.address;
      const rpCvxBalance = await rpCvx.balanceOf(sender, epoch);
      const to = admin.address;
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await rpCvx.connect(notAdmin).setApprovalForAll(pCvx.address, true);

      expect(rpCvxBalance.lt(amount)).to.equal(true);
      await expect(
        pCvx.connect(notAdmin).exchangeFutures(epoch, to, amount, i, o)
      ).to.be.revertedWith('ERC1155: burn amount exceeds balance');
    });

    it('Should revert if to is zero address', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const invalidTo = zeroAddress;
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(epoch, invalidTo, amount, i, o)
      ).to.be.revertedWith('ERC1155: mint to the zero address');
    });

    it('Should exchange rewards futures for vote futures', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());
      const vpCvx = await this.getVpCvx(await pCvx.vpCvx());
      const sender = admin.address;
      const to = admin.address;
      const rpCvxBalanceBefore = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceBefore = await vpCvx.balanceOf(to, epoch);
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;
      const events = await callAndReturnEvents(pCvx.exchangeFutures, [
        epoch,
        to,
        amount,
        i,
        o,
      ]);
      const exchangeEvent = events[0];
      const rpCvxBalanceAfter = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceAfter = await vpCvx.balanceOf(to, epoch);

      expect(rpCvxBalanceAfter).to.equal(rpCvxBalanceBefore.sub(amount));
      expect(vpCvxBalanceAfter).to.equal(vpCvxBalanceBefore.add(amount));
      validateEvent(
        exchangeEvent,
        'ExchangeFutures(uint256,address,uint256,uint8,uint8)',
        {
          epoch,
          to,
          amount,
          i,
          o,
        }
      );
    });
  });
});
