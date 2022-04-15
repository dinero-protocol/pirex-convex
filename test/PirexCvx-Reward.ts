import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import {
  callAndReturnEvents,
  toBN,
  increaseBlockTimestamp,
  validateEvent,
  parseLog,
} from './helpers';
import {
  ConvexToken,
  CvxLockerV2,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
  PxCvx,
} from '../typechain-types';
import { BalanceTree } from '../lib/merkle';

// Tests the rewards related logic
describe('PirexCvx-Reward', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pxCvx: PxCvx;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let cvx: ConvexToken;
  let crv: Crv;
  let cvxCrvToken: any;
  let cvxLocker: CvxLockerV2;
  let votiumMultiMerkleStash: MultiMerkleStash;

  let zeroAddress: string;
  let feeDenominator: number;
  let feePercentDenominator: number;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;
  let snapshotRedeemEpoch: BigNumber;

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
      pxCvx,
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
      const epochBefore = await pxCvx.getEpoch(currentEpoch);
      const snapshotIdBefore = await pxCvx.getCurrentSnapshotId();
      const events = await callAndReturnEvents(pxCvx.takeEpochSnapshot, []);
      const snapshotEvent = events[0];
      const epochAfter = await pxCvx.getEpoch(currentEpoch);
      const snapshotIdAfter = await pxCvx.getCurrentSnapshotId();

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
      const { snapshotId: snapshotIdBefore } = await pxCvx.getEpoch(
        currentEpoch
      );

      await pxCvx.takeEpochSnapshot();

      const { snapshotId: snapshotIdAfter } = await pxCvx.getEpoch(
        currentEpoch
      );

      expect(snapshotIdAfter).to.equal(snapshotIdBefore);
    });

    it('should revert if the contract is paused', async function () {
      await pCvx.setPauseState(true);

      await expect(pxCvx.takeEpochSnapshot()).to.be.revertedWith('Paused()');

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

      await pxCvx.approve(pCvx.address, assets);
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

    it('Should revert if votiumRewards.length is zero', async function () {
      const votiumRewards: any[] = [];

      await expect(pCvx.claimVotiumRewards(votiumRewards)).to.be.revertedWith(
        'EmptyArray()'
      );
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
      const votiumRewards: any[] = [
        [tokens[0], indexes[0], amounts[0], merkleProofs[0]],
        [tokens[1], indexes[1], amounts[1], merkleProofs[1]],
      ];

      snapshotRedeemEpoch = await pCvx.getCurrentEpoch();
      const currentEpoch = snapshotRedeemEpoch;
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
        votiumRewards,
      ]);
      const cvxVotiumRewardClaimEvent = events[0];
      const votiumToPirexCvxTransferEvent = parseLog(pxCvx, events[1]);
      const cvxFeeTreasuryDistributionEvent = parseLog(pxCvx, events[5]);
      const cvxFeeContributorsDistributionEvent = parseLog(pxCvx, events[7]);
      const crvVotiumRewardClaimEvent = events[9];
      const votiumToPirexCrvTransfer = parseLog(pxCvx, events[10]);
      const crvFeeTreasuryDistributionEvent = parseLog(pxCvx, events[15]);
      const crvFeeContributorsDistributionEvent = parseLog(
        pxCvx,
        events[events.length - 1]
      );
      const votium = await pCvx.votiumMultiMerkleStash();
      const { snapshotId, rewards, snapshotRewards, futuresRewards } =
        await pxCvx.getEpoch(currentEpoch);
      const snapshotSupply = await pxCvx.totalSupplyAt(snapshotId);
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
      const parsedRewards = rewards.map((r) => r.slice(0, 42));

      expect(parsedRewards.includes(tokens[0].toLowerCase())).to.equal(true);
      expect(parsedRewards.includes(tokens[1].toLowerCase())).to.equal(true);
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
          amount: amounts[0],
        }
      );
      validateEvent(
        cvxFeeTreasuryDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: treasury.address,
          amount: treasuryCvxBalanceAfter.sub(treasuryCvxBalanceBefore),
        }
      );
      validateEvent(
        cvxFeeContributorsDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: contributors.address,
          amount: contributorsCvxBalanceAfter.sub(contributorsCvxBalanceBefore),
        }
      );
      validateEvent(
        votiumToPirexCrvTransfer,
        'Transfer(address,address,uint256)',
        {
          from: votium,
          to: pCvx.address,
          amount: amounts[1],
        }
      );
      validateEvent(
        crvFeeTreasuryDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: treasury.address,
          amount: treasuryCrvBalanceAfter.sub(treasuryCrvBalanceBefore),
        }
      );
      validateEvent(
        crvFeeContributorsDistributionEvent,
        'Transfer(address,address,uint256)',
        {
          from: pCvx.address,
          to: contributors.address,
          amount: contributorsCrvBalanceAfter.sub(contributorsCrvBalanceBefore),
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
      ).to.equal(true);
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
      const votiumRewards: any[] = [
        [tokens[0], indexes[0], amounts[0], proofs[0]],
        [tokens[1], indexes[1], amounts[1], proofs[1]],
      ];

      await pCvx.claimVotiumRewards(votiumRewards);
    });

    it('Should revert if rewardIndexes is an empty array', async function () {
      const epoch = snapshotRedeemEpoch;
      const invalidRewardIndexes: any = [];
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotRewards(epoch, invalidRewardIndexes, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should redeem a single snapshot reward', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const currentEpoch = snapshotRedeemEpoch;
      const { snapshotId, snapshotRewards } = await pxCvx.getEpoch(
        currentEpoch
      );
      const snapshotBalance = await pxCvx.balanceOfAt(
        admin.address,
        snapshotId
      );
      const snapshotSupply = await pxCvx.totalSupplyAt(snapshotId);
      const rewardIndexes = [0];
      const receiver = admin.address;
      const [redeemEvent] = await callAndReturnEvents(
        pCvx.redeemSnapshotRewards,
        [currentEpoch, rewardIndexes, receiver]
      );
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const expectedCvxRewards = snapshotRewards[rewardIndexes[0]]
        .mul(snapshotBalance)
        .div(snapshotSupply);

      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      validateEvent(
        redeemEvent,
        'RedeemSnapshotRewards(uint256,uint256[],address,uint256,uint256)',
        {
          epoch: currentEpoch,
          rewardIndexes: rewardIndexes.map((b) => toBN(b)),
          receiver,
          snapshotBalance,
          snapshotSupply,
        }
      );
    });

    it('Should redeem multiple snapshot rewards', async function () {
      const epoch = snapshotRedeemEpoch;
      const rewardIndexes = [1, 2, 3];
      const receiver = admin.address;
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const events = await callAndReturnEvents(pCvx.redeemSnapshotRewards, [
        epoch,
        rewardIndexes,
        receiver,
      ]);
      const redeemEvent = events[0];
      const transferEvent1 = parseLog(pxCvx, events[1]);
      const transferEvent2 = parseLog(pxCvx, events[2]);
      const transferEvent3 = parseLog(pxCvx, events[3]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const { snapshotId, snapshotRewards } = await pxCvx.getEpoch(
        snapshotRedeemEpoch
      );
      const snapshotBalance = await pxCvx.balanceOfAt(
        admin.address,
        snapshotId
      );
      const snapshotSupply = await pxCvx.totalSupplyAt(snapshotId);
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
        redeemEvent,
        'RedeemSnapshotRewards(uint256,uint256[],address,uint256,uint256)',
        {
          epoch,
          rewardIndexes: rewardIndexes.map((b) => toBN(b)),
          receiver,
          snapshotBalance,
          snapshotSupply,
        }
      );
      validateEvent(transferEvent1, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        amount: expectedSnapshotCrvRewards[0],
      });
      validateEvent(transferEvent2, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        amount: expectedSnapshotCvxRewards,
      });
      validateEvent(transferEvent3, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        amount: expectedSnapshotCrvRewards[1],
      });
    });

    it('Should revert if msg.sender has already redeemed', async function () {
      const epoch = snapshotRedeemEpoch;
      const rewardIndexes = [2];
      const receiver = admin.address;

      await expect(
        pCvx.redeemSnapshotRewards(epoch, rewardIndexes, receiver)
      ).to.be.revertedWith('AlreadyRedeemed()');
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
      const invalidEpoch = snapshotRedeemEpoch.add(1);
      const receiver = admin.address;

      await expect(
        pCvx.redeemFuturesRewards(invalidEpoch, receiver)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if receiver is zero address', async function () {
      const epoch = snapshotRedeemEpoch;
      const invalidReceiver = zeroAddress;
      const rpCvx = await this.getRpCvx(await pCvx.rpCvx());

      await rpCvx.setApprovalForAll(pCvx.address, true);

      await expect(
        pCvx.redeemFuturesRewards(epoch, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender has an insufficient balance', async function () {
      const epoch = snapshotRedeemEpoch;
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).redeemFuturesRewards(epoch, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('should revert if the contract is paused', async function () {
      const epoch = snapshotRedeemEpoch;
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
      const epoch = snapshotRedeemEpoch;
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
      const { rewards, futuresRewards } = await pxCvx.getEpoch(epoch);
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
        'RedeemFuturesRewards(uint256,address,bytes32[])',
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
      const invalidEpoch1 = snapshotRedeemEpoch;
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
      const epoch = snapshotRedeemEpoch.add(epochDuration);
      const invalidAmount = 0;
      const receiver = admin.address;
      const f = futuresEnum.reward;

      await expect(
        pCvx.exchangeFutures(epoch, invalidAmount, receiver, f)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const epoch = snapshotRedeemEpoch.add(epochDuration);
      const amount = toBN(1);
      const invalidReceiver = zeroAddress;
      const f = futuresEnum.reward;

      await expect(
        pCvx.exchangeFutures(epoch, amount, invalidReceiver, f)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender balance is insufficient', async function () {
      const epoch = snapshotRedeemEpoch.add(epochDuration);
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
      const epoch = snapshotRedeemEpoch.add(epochDuration);
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
      const epoch = snapshotRedeemEpoch.add(epochDuration);
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
