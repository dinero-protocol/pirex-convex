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

    it('Should not take a snapshot if already taken for the epoch', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId: snapshotIdBefore } = await pCvx.getEpoch(
        currentEpoch
      );

      await pCvx.takeEpochSnapshot();

      const { snapshotId: snapshotIdAfter } = await pCvx.getEpoch(currentEpoch);

      expect(snapshotIdAfter).to.equal(snapshotIdBefore);
    });

    it('should revert if the contract is paused', async function () {
      await pCvx.setPauseState(true);

      await expect(pCvx.takeEpochSnapshot()).to.be.revertedWith(
        'Pausable: paused'
      );

      await pCvx.setPauseState(false);
    });
  });

  describe('claimVotiumRewards', function () {
    let cvxRewardDistribution: { account: string; amount: BigNumber }[];
    let crvRewardDistribution: { account: string; amount: BigNumber }[];
    let cvxTree: BalanceTree;
    let crvTree: BalanceTree;

    before(async function () {
      // Provision rpCVX tokens for futures redemption later
      const assets = toBN(5e17);

      await pCvx.approve(pCvx.address, assets);
      await pCvx.stake(255, futuresEnum.reward, assets, admin.address);

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

    it('Should revert if tokens.length is zero', async function () {
      const invalidTokens: any = [];
      const indexes = [0, 0];
      const amounts = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const merkleProofs = [
        cvxTree.getProof(indexes[0], pCvx.address, amounts[0]),
        crvTree.getProof(indexes[1], pCvx.address, amounts[1]),
      ];

      await expect(
        pCvx.claimVotiumRewards(invalidTokens, indexes, amounts, merkleProofs)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if array lengths are mismatched', async function () {
      const tokens: any = [cvx.address, crv.address];
      const indexes: any = [0, 0];
      const amounts: any = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const merkleProofs: any = [
        cvxTree.getProof(indexes[0], pCvx.address, amounts[0]),
        crvTree.getProof(indexes[1], pCvx.address, amounts[1]),
      ];

      await expect(
        pCvx.claimVotiumRewards([tokens[0]], indexes, amounts, merkleProofs)
      ).to.be.revertedWith('MismatchedArrayLengths()');
      await expect(
        pCvx.claimVotiumRewards(tokens, [indexes[0]], amounts, merkleProofs)
      ).to.be.revertedWith('MismatchedArrayLengths()');
      await expect(
        pCvx.claimVotiumRewards(tokens, indexes, [amounts[0]], merkleProofs)
      ).to.be.revertedWith('MismatchedArrayLengths()');
      await expect(
        pCvx.claimVotiumRewards(tokens, indexes, amounts, [merkleProofs[0]])
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('Should claim Votium rewards', async function () {
      const tokens: any = [cvx.address, crv.address];
      const indexes: any = [0, 0];
      const amounts: any = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const merkleProofs: any = [
        cvxTree.getProof(indexes[0], pCvx.address, amounts[0]),
        crvTree.getProof(indexes[1], pCvx.address, amounts[1]),
      ];
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
      const events = await callAndReturnEvents(pCvx.claimVotiumRewards, [
        tokens,
        indexes,
        amounts,
        merkleProofs,
      ]);
      const cvxVotiumRewardClaimEvent = events[0];
      const votiumToPirexCvxTransferEvent = events[1];
      const cvxFeeTreasuryDistributionEvent = events[5];
      const cvxFeeContributorsDistributionEvent = events[7];
      const crvVotiumRewardClaimEvent = events[9];
      const votiumToPirexCrvTransfer = events[10];
      const crvFeeTreasuryDistributionEvent = events[15];
      const crvFeeContributorsDistributionEvent = events[events.length - 1];
      const votium = await pCvx.votiumMultiMerkleStash();
      const { snapshotId, rewards, snapshotRewards, futuresRewards } =
        await pCvx.getEpoch(currentEpoch);
      const snapshotSupply = await pCvx.totalSupplyAt(snapshotId);
      const votiumSnapshotRewards = snapshotRewards;
      const votiumFuturesRewards = futuresRewards;

      const expectedVotiumSnapshotRewards = {
        amounts: amounts.map((amount: BigNumber) => {
          const feeAmount = amount.mul(rewardFee).div(feeDenominator);

          return amount
            .sub(feeAmount)
            .mul(snapshotSupply)
            .div(snapshotSupply.add(epochRpCvxSupply));
        }),
      };
      const expectedVotiumFuturesRewards = {
        amounts: amounts.map((amount: BigNumber) => {
          const feeAmount = amount.mul(rewardFee).div(feeDenominator);
          const snapshotRewards = amount
            .sub(feeAmount)
            .mul(snapshotSupply)
            .div(snapshotSupply.add(epochRpCvxSupply));

          return amount.sub(feeAmount).sub(snapshotRewards);
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

      expect(rewards.includes(tokens[0])).to.equal(true);
      expect(rewards.includes(tokens[1])).to.equal(true);
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
        cvxVotiumRewardClaimEvent,
        'ClaimVotiumReward(address,uint256,uint256)',
        {
          token: tokens[0],
          index: indexes[0],
          amount: amounts[0],
        }
      );
      validateEvent(
        crvVotiumRewardClaimEvent,
        'ClaimVotiumReward(address,uint256,uint256)',
        {
          token: tokens[1],
          index: indexes[1],
          amount: amounts[1],
        }
      );
      validateEvent(
        votiumToPirexCvxTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: votium,
          to: pCvx.address,
          value: amounts[0],
        }
      );
      validateEvent(
        cvxFeeTreasuryDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: treasury.address,
          value: treasuryCvxBalanceAfter.sub(treasuryCvxBalanceBefore),
        }
      );
      validateEvent(
        cvxFeeContributorsDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: contributors.address,
          value: contributorsCvxBalanceAfter.sub(contributorsCvxBalanceBefore),
        }
      );
      validateEvent(
        votiumToPirexCrvTransfer,
        'Transfer(address,address,uint256)',
        {
          from: votium,
          to: pCvx.address,
          value: amounts[1],
        }
      );
      validateEvent(
        crvFeeTreasuryDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: treasury.address,
          value: treasuryCrvBalanceAfter.sub(treasuryCrvBalanceBefore),
        }
      );
      validateEvent(
        crvFeeContributorsDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: contributors.address,
          value: contributorsCrvBalanceAfter.sub(contributorsCrvBalanceBefore),
        }
      );
    });
  });

  describe('claimMiscRewards', function () {
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
      await increaseBlockTimestamp(1000);
    });

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
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(invalidEpoch, rewardIndex, receiver)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if receiver is zero address', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const invalidReceiver = zeroAddress;

      await expect(
        pCvx.redeemSnapshotReward(epoch, rewardIndex, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if rewardIndex is not associated with a reward', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidRewardIndex = 5;
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(epoch, invalidRewardIndex, receiver)
      ).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)'
      );
    });

    it('Should revert if msg.sender has an insufficient balance', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const receiver = admin.address;

      await expect(
        pCvx
          .connect(notAdmin)
          .redeemSnapshotReward(epoch, rewardIndex, receiver)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('should revert if the contract is paused', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const receiver = admin.address;

      await pCvx.setPauseState(true);

      await expect(
        pCvx.redeemSnapshotReward(epoch, rewardIndex, receiver)
      ).to.be.revertedWith('Pausable: paused');

      await pCvx.setPauseState(false);
    });

    it('Should redeem a single snapshot reward', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId, snapshotRewards } = await pCvx.getEpoch(currentEpoch);
      const snapshotBalance = await pCvx.balanceOfAt(admin.address, snapshotId);
      const snapshotSupply = await pCvx.totalSupplyAt(snapshotId);
      const receiver = admin.address;
      const [cvxEvent] = await callAndReturnEvents(pCvx.redeemSnapshotReward, [
        currentEpoch,
        0,
        receiver,
      ]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const expectedCvxRewards = snapshotRewards[0]
        .mul(snapshotBalance)
        .div(snapshotSupply);

      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      validateEvent(
        cvxEvent,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch: currentEpoch,
          rewardIndex: 0,
          receiver,
          snapshotId,
          snapshotBalance,
          redeemAmount: expectedCvxRewards,
        }
      );
    });

    it('Should revert if msg.sender has already redeemed', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotReward(epoch, rewardIndex, receiver)
      ).to.be.revertedWith('AlreadyRedeemed()');
    });
  });

  describe('redeemSnapshotRewards', function () {
    before(async function () {
      const cvxRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(2e18),
        },
      ];
      const crvRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(2e18),
        },
      ];
      const cvxTree = new BalanceTree(cvxRewardDistribution);
      const crvTree = new BalanceTree(crvRewardDistribution);

      await cvx.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await crv.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        cvx.address,
        cvxTree.getHexRoot()
      );
      await votiumMultiMerkleStash.updateMerkleRoot(
        crv.address,
        crvTree.getHexRoot()
      );

      const tokens = [cvx.address, crv.address];
      const indexes = [0, 0];
      const amounts = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const proofs = [
        cvxTree.getProof(
          indexes[0],
          pCvx.address,
          cvxRewardDistribution[0].amount
        ),
        crvTree.getProof(
          indexes[1],
          pCvx.address,
          crvRewardDistribution[0].amount
        ),
      ];

      await pCvx.claimVotiumRewards(tokens, indexes, amounts, proofs);
    });

    it('Should revert if rewardIndexes is an empty array', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidRewardIndexes: any = [];
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotRewards(epoch, invalidRewardIndexes, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should redeem multiple snapshot rewards', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndexes = [1, 2, 3];
      const receiver = admin.address;
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const events = await callAndReturnEvents(pCvx.redeemSnapshotRewards, [
        epoch,
        rewardIndexes,
        receiver,
      ]);
      const redeemEvent1 = events[0];
      const transferEvent1 = events[1];
      const redeemEvent2 = events[2];
      const transferEvent2 = events[3];
      const redeemEvent3 = events[4];
      const transferEvent3 = events[5];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const { snapshotId, snapshotRewards } = await pCvx.getEpoch(
        await pCvx.getCurrentEpoch()
      );
      const snapshotBalance = await pCvx.balanceOfAt(admin.address, snapshotId);
      const snapshotSupply = await pCvx.totalSupplyAt(snapshotId);
      const expectedSnapshotCrvRewards = [
        snapshotRewards[rewardIndexes[0]]
          .mul(snapshotBalance)
          .div(snapshotSupply),
        snapshotRewards[rewardIndexes[2]]
          .mul(snapshotBalance)
          .div(snapshotSupply),
      ];
      const expectedSnapshotCvxRewards = snapshotRewards[rewardIndexes[1]]
        .mul(snapshotBalance)
        .div(snapshotSupply);
      const totalExpectedSnapshotCrvRewards = expectedSnapshotCrvRewards.reduce(
        (acc, val) => acc.add(val),
        toBN(0)
      );

      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedSnapshotCvxRewards)
      );
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(totalExpectedSnapshotCrvRewards)
      );
      validateEvent(
        redeemEvent1,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch,
          rewardIndex: rewardIndexes[0],
          receiver,
          snapshotId,
          snapshotBalance,
          redeemAmount: expectedSnapshotCrvRewards[0],
        }
      );
      validateEvent(
        redeemEvent2,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch,
          rewardIndex: rewardIndexes[1],
          receiver,
          snapshotId,
          snapshotBalance,
          redeemAmount: expectedSnapshotCvxRewards,
        }
      );
      validateEvent(
        redeemEvent3,
        'RedeemSnapshotReward(uint256,uint256,address,uint256,uint256,uint256)',
        {
          epoch,
          rewardIndex: rewardIndexes[2],
          receiver,
          snapshotId,
          snapshotBalance,
          redeemAmount: expectedSnapshotCrvRewards[1],
        }
      );
      validateEvent(transferEvent1, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        value: expectedSnapshotCrvRewards[0],
      });
      validateEvent(transferEvent2, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        value: expectedSnapshotCvxRewards,
      });
      validateEvent(transferEvent3, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        value: expectedSnapshotCrvRewards[1],
      });
    });
  });

  describe('redeemFuturesRewards', function () {
    it('Should revert if epoch is zero', async function () {
      const invalidEpoch = 0;
      const receiver = admin.address;

      await expect(
        pCvx.redeemFuturesRewards(invalidEpoch, receiver)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if epoch is greater than the current epoch', async function () {
      const invalidEpoch = (await pCvx.getCurrentEpoch()).add(1);
      const receiver = admin.address;

      await expect(
        pCvx.redeemFuturesRewards(invalidEpoch, receiver)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if receiver is zero address', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidReceiver = zeroAddress;
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());

      await rpCvx.setApprovalForAll(pCvx.address, true);

      await expect(
        pCvx.redeemFuturesRewards(epoch, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender has an insufficient balance', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).redeemFuturesRewards(epoch, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('should revert if the contract is paused', async function () {
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;

      await pCvx.setPauseState(true);

      await expect(pCvx.redeemFuturesRewards(epoch, to)).to.be.revertedWith(
        'Pausable: paused'
      );

      await pCvx.setPauseState(false);
    });

    it('Should redeem futures reward', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const epoch = await pCvx.getCurrentEpoch();
      const receiver = admin.address;
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());

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
        receiver,
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
      const totalExpectedCvxClaimAmounts = expectedClaimAmounts[0].add(
        expectedClaimAmounts[2]
      );
      const totalExpectedCrvClaimAmounts = expectedClaimAmounts[1].add(
        expectedClaimAmounts[3]
      );

      expect(rpCvxBalanceAfter).to.not.equal(rpCvxBalanceBefore);
      expect(rpCvxBalanceAfter).to.equal(0);
      expect(rpCvxSupplyAfter).to.not.equal(rpCvxSupplyBefore);
      expect(rpCvxSupplyAfter).to.equal(
        rpCvxSupplyBefore.sub(rpCvxBalanceBefore)
      );
      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(totalExpectedCvxClaimAmounts)
      );
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(totalExpectedCrvClaimAmounts)
      );
      validateEvent(
        redeemEvent,
        'RedeemFuturesRewards(uint256,address,address[])',
        {
          epoch,
          receiver,
          rewards,
        }
      );
    });
  });

  describe('exchangeFutures', function () {
    it('Should revert if epoch is current', async function () {
      const invalidEpoch1 = await pCvx.getCurrentEpoch();
      const invalidEpoch2 = invalidEpoch1.sub(epochDuration);
      const amount = toBN(1e18);
      const receiver = admin.address;
      const f = futuresEnum.reward;

      await expect(
        pCvx.exchangeFutures(invalidEpoch1, amount, receiver, f)
      ).to.be.revertedWith('PastExchangePeriod()');
      await expect(
        pCvx.exchangeFutures(invalidEpoch2, amount, receiver, f)
      ).to.be.revertedWith('PastExchangePeriod()');
    });

    it('Should revert if amount is zero', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const invalidAmount = 0;
      const receiver = admin.address;
      const f = futuresEnum.reward;

      await expect(
        pCvx.exchangeFutures(epoch, invalidAmount, receiver, f)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const amount = toBN(1);
      const invalidReceiver = zeroAddress;
      const f = futuresEnum.reward;

      await expect(
        pCvx.exchangeFutures(epoch, amount, invalidReceiver, f)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender balance is insufficient', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());
      const sender = notAdmin.address;
      const rpCvxBalance = await rpCvx.balanceOf(sender, epoch);
      const amount = toBN(1);
      const receiver = admin.address;
      const f = futuresEnum.reward;

      await rpCvx.connect(notAdmin).setApprovalForAll(pCvx.address, true);

      expect(rpCvxBalance.lt(amount)).to.equal(true);
      await expect(
        pCvx.connect(notAdmin).exchangeFutures(epoch, amount, receiver, f)
      ).to.be.revertedWith('ERC1155: burn amount exceeds balance');
    });

    it('should revert if the contract is paused', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const amount = toBN(1);
      const receiver = admin.address;
      const f = futuresEnum.reward;

      await pCvx.setPauseState(true);

      await expect(
        pCvx.exchangeFutures(epoch, amount, receiver, f)
      ).to.be.revertedWith('Pausable: paused');

      await pCvx.setPauseState(false);
    });

    it('Should exchange rewards futures for vote futures', async function () {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());
      const vpCvx = await this.getVpCvx(await pCvx.vpCvx());
      const sender = admin.address;
      const receiver = admin.address;
      const rpCvxBalanceBefore = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceBefore = await vpCvx.balanceOf(receiver, epoch);
      const amount = toBN(1);
      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pCvx.exchangeFutures, [
        epoch,
        amount,
        receiver,
        f,
      ]);
      const exchangeEvent = events[0];
      const rpCvxBalanceAfter = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceAfter = await vpCvx.balanceOf(receiver, epoch);

      expect(rpCvxBalanceAfter).to.equal(rpCvxBalanceBefore.sub(amount));
      expect(vpCvxBalanceAfter).to.equal(vpCvxBalanceBefore.add(amount));
      validateEvent(
        exchangeEvent,
        'ExchangeFutures(uint256,uint256,address,uint8)',
        {
          epoch,
          amount,
          receiver,
          f,
        }
      );
    });
  });
});
