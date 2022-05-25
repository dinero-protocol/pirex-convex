import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { every } from 'lodash';
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
  PirexFees,
  PxCvx,
  UnionPirexVault,
} from '../typechain-types';

// Tests the actual deposit flow (deposit, stake/unstake, redeem...)
describe('PirexCvx-Main', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexCvx: PirexCvx;
  let pirexFees: PirexFees;
  let unionPirex: UnionPirexVault;
  let cvx: ConvexToken;
  let cvxLocker: CvxLockerV2;

  let zeroAddress: string;
  let redemptionUnlockTime1: BigNumber;
  let redemptionUnlockTime2: BigNumber;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;
  let feePercentDenominator: number;
  let stakeExpiry: BigNumber;

  before(async function () {
    ({
      admin,
      notAdmin,
      pxCvx,
      pirexCvx,
      pirexFees,
      unionPirex,
      cvx,
      cvxLocker,
      zeroAddress,
      redemptionUnlockTime1,
      epochDuration,
      futuresEnum,
      feePercentDenominator,
      feesEnum,
    } = this);
  });

  describe('deposit', function () {
    it('Should revert if assets is zero', async function () {
      const invalidAssets = toBN(0);
      const receiver = admin.address;
      const shouldCompound = true;
      const developer = zeroAddress;

      await expect(
        pirexCvx.deposit(invalidAssets, receiver, shouldCompound, developer)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;
      const shouldCompound = true;
      const developer = zeroAddress;

      await expect(
        pirexCvx.deposit(assets, invalidReceiver, shouldCompound, developer)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender asset balance is insufficient', async function () {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const invalidAssets = cvxBalance.add(1);
      const receiver = admin.address;
      const shouldCompound = true;
      const developer = zeroAddress;

      await expect(
        pirexCvx.deposit(invalidAssets, receiver, shouldCompound, developer)
      ).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('should revert if the contract is paused', async function () {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const receiver = admin.address;
      const shouldCompound = true;
      const developer = zeroAddress;

      await pirexCvx.setPauseState(true);

      await expect(
        pirexCvx.deposit(cvxBalance, receiver, shouldCompound, developer)
      ).to.be.revertedWith('Pausable: paused');

      await pirexCvx.setPauseState(false);
    });

    it('Should deposit CVX', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const lockedBalanceBefore = await cvxLocker.lockedBalanceOf(pirexCvx.address);
      const unionTotalAssetsBefore = await unionPirex.totalAssets();
      const pxCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const assets = toBN(10e18);
      const receiver = admin.address;
      const shouldCompound = true;
      const developer = zeroAddress;

      // Necessary since pirexCVX transfers CVX to itself before locking
      await cvx.approve(pirexCvx.address, assets);

      const approved = await cvx.allowance(admin.address, pirexCvx.address);
      const expectedShares = await unionPirex.convertToShares(assets);
      const events = await callAndReturnEvents(pirexCvx.deposit, [
        assets,
        receiver,
        shouldCompound,
        developer,
      ]);

      await pirexCvx.lock();

      const depositEvent = events[0];
      const pxCvxMintEvent = parseLog(pxCvx, events[1]);
      const cvxTransferEvent = parseLog(cvx, events[2]);
      const cvxApprovalEvent = parseLog(cvx, events[3]);
      const vaultAssetTransferEvent = parseLog(unionPirex, events[4]);
      const vaultShareMintEvent = parseLog(unionPirex, events[5]);
      const vaultDepositEvent = parseLog(unionPirex, events[6]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const lockedBalanceAfter = await cvxLocker.lockedBalanceOf(pirexCvx.address);
      const unionTotalAssetsAfter = await unionPirex.totalAssets();
      const pxCvxBalanceAfter = await unionPirex.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(assets));
      expect(lockedBalanceAfter).to.equal(lockedBalanceBefore.add(assets));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.add(assets));
      expect(unionTotalAssetsAfter).to.equal(
        unionTotalAssetsBefore.add(assets)
      );

      validateEvent(depositEvent, 'Deposit(uint256,address,bool,address)', {
        assets,
        receiver,
      });

      validateEvent(pxCvxMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: pirexCvx.address,
        amount: assets,
      });

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: pirexCvx.address,
        value: assets,
      });

      validateEvent(cvxApprovalEvent, 'Approval(address,address,uint256)', {
        owner: admin.address,
        spender: pirexCvx.address,
        value: approved.sub(assets),
      });

      validateEvent(
        vaultAssetTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: pirexCvx.address,
          to: unionPirex.address,
          amount: assets,
        }
      );

      validateEvent(vaultShareMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: receiver,
        amount: expectedShares,
      });

      validateEvent(
        vaultDepositEvent,
        'Deposit(address,address,uint256,uint256)',
        {
          caller: pirexCvx.address,
          owner: receiver,
          assets,
          shares: expectedShares,
        }
      );
    });
  });

  describe('initiateRedemptions', function () {
    before(async () => {
      const amount = toBN(1e18);

      await cvx.approve(pirexCvx.address, amount);
      await pirexCvx.deposit(amount, admin.address, false, zeroAddress);
      await pirexCvx.lock();
    });

    it('Should revert if lockIndexes is an empty array', async function () {
      const invalidLockIndexes: any = [];
      const f = futuresEnum.reward;
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pirexCvx.initiateRedemptions(invalidLockIndexes, f, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if lockIndexes is out of bounds', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pirexCvx.address);
      const invalidLockIndexes = [lockData.length + 1];
      const f = futuresEnum.reward;
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pirexCvx.initiateRedemptions(invalidLockIndexes, f, assets, receiver)
      ).to.be.revertedWith(
        'reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)'
      );
    });

    it('Should revert if futures enum is out of range', async function () {
      const lockIndexes = [0];
      const to = admin.address;
      const assets = [toBN(1e18)];
      const invalidF = futuresEnum.reward + 1;

      await expect(
        pirexCvx.initiateRedemptions(lockIndexes, invalidF, assets, to)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if assets element is zero', async function () {
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const invalidAssets = [toBN(0)];
      const receiver = admin.address;

      await expect(
        pirexCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if redemption exceeds amount of CVX being unlocked', async function () {
      await increaseBlockTimestamp(Number(epochDuration));

      const assets = toBN(1e18);

      await cvx.approve(pirexCvx.address, assets);
      await pirexCvx.deposit(assets, admin.address, true, zeroAddress);
      await pirexCvx.lock();

      const { lockData } = await cvxLocker.lockedBalances(pirexCvx.address);
      const lockIndexes = [1];
      const f = futuresEnum.reward;
      const invalidAssets = [lockData[lockIndexes[0]].amount.add(assets)];
      const receiver = admin.address;

      expect(lockData[lockIndexes[0]].amount.lt(invalidAssets[0])).is.true;
      await expect(
        pirexCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });

    it('Should revert if pirexCvx balance is insufficient', async function () {
      const pxCvxBalance = await pxCvx.balanceOf(notAdmin.address);
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const invalidAssets = [pxCvxBalance.add(1)];
      const receiver = admin.address;

      expect(pxCvxBalance.lt(invalidAssets[0])).to.equal(true);
      await expect(
        pirexCvx
          .connect(notAdmin)
          .initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('0x11');
    });

    it('should revert if the contract is paused', async function () {
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const assets = [await pxCvx.balanceOf(notAdmin.address)];
      const receiver = admin.address;

      await pirexCvx.setPauseState(true);

      await expect(
        pirexCvx.initiateRedemptions(lockIndexes, f, assets, receiver)
      ).to.be.revertedWith('Pausable: paused');

      await pirexCvx.setPauseState(false);
    });

    it('Should initiate multiple redemptions', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const { lockData } = await cvxLocker.lockedBalances(pirexCvx.address);
      const lockIndexes = [0, 1];
      const { unlockTime: unlockTime1 } = lockData[lockIndexes[0]];
      const { unlockTime: unlockTime2 } = lockData[lockIndexes[1]];

      redemptionUnlockTime1 = toBN(unlockTime1);
      redemptionUnlockTime2 = toBN(unlockTime2);

      const upxCvx = await this.getUpxCvx(await pirexCvx.upxCvx());
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const pxCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsBefore = await pirexCvx.outstandingRedemptions();
      const upxCvxBalanceBefore1 = await upxCvx.balanceOf(
        admin.address,
        unlockTime1
      );
      const upxCvxBalanceBefore2 = await upxCvx.balanceOf(
        admin.address,
        unlockTime2
      );
      const msgSender = admin.address;
      const assets = [toBN(1e18), toBN(1e18)];
      const receiver = admin.address;

      await unionPirex.redeem(assets[0].add(assets[1]), msgSender, msgSender);

      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pirexCvx.initiateRedemptions, [
        lockIndexes,
        f,
        assets,
        receiver,
      ]);
      const initiateEvent = events[0];
      const mintFuturesEvent1 = events[2];
      const mintFuturesEvent2 = events[5];
      const burnEvent = parseLog(pxCvx, events[7]);
      const pirexFeesApprovalEvent = parseLog(pxCvx, events[8]);
      const treasuryFeeTransferEvent = parseLog(pxCvx, events[10]);
      const contributorsFeeTransferEvent = parseLog(pxCvx, events[11]);
      const pxCvxBalanceAfter = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsAfter = await pirexCvx.outstandingRedemptions();
      const upxCvxBalanceAfter1 = await upxCvx.balanceOf(
        admin.address,
        unlockTime1
      );
      const upxCvxBalanceAfter2 = await upxCvx.balanceOf(
        admin.address,
        unlockTime2
      );
      const remainingTime1 = toBN(unlockTime1).sub(timestamp);
      const remainingTime2 = toBN(unlockTime2).sub(timestamp);
      const feeMin = toBN(await pirexCvx.fees(feesEnum.redemptionMin));
      const feeMax = toBN(await pirexCvx.fees(feesEnum.redemptionMax));
      const maxRedemptionTime = await pirexCvx.MAX_REDEMPTION_TIME();
      const feeDenominator = await pirexCvx.FEE_DENOMINATOR();
      const feePercent1 = feeMax.sub(
        feeMax.sub(feeMin).mul(remainingTime1).div(maxRedemptionTime)
      );
      const feePercent2 = feeMax.sub(
        feeMax.sub(feeMin).mul(remainingTime2).div(maxRedemptionTime)
      );
      const feeAmount1 = assets[0].mul(feePercent1).div(feeDenominator);
      const postFeeAmount1 = assets[0].sub(feeAmount1);
      const feeAmount2 = assets[1].mul(feePercent2).div(feeDenominator);
      const postFeeAmount2 = assets[1].sub(feeAmount2);
      const expectedRewardsRounds1 = remainingTime1.div(epochDuration);
      const expectedRewardsRounds2 = remainingTime2.div(epochDuration);
      const rpxCvxBalances1 = await this.getFuturesCvxBalances(
        Number(expectedRewardsRounds1),
        futuresEnum.reward,
        currentEpoch
      );
      const rpxCvxBalances2 = await this.getFuturesCvxBalances(
        Number(expectedRewardsRounds2),
        futuresEnum.reward,
        currentEpoch
      );
      const totalAssets = assets[0].add(assets[1]);
      const totalFeeAmounts = feeAmount1.add(feeAmount2);
      const totalPostFeeAmounts = postFeeAmount1.add(postFeeAmount2);
      const feeTreasuryPercent = await pirexFees.treasuryPercent();
      const feeContributorPercent = feePercentDenominator - feeTreasuryPercent;

      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.sub(totalAssets));
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.add(totalPostFeeAmounts)
      );
      expect(upxCvxBalanceAfter1).to.equal(
        upxCvxBalanceBefore1.add(postFeeAmount1)
      );
      expect(upxCvxBalanceAfter2).to.equal(
        upxCvxBalanceBefore2.add(postFeeAmount2)
      );

      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: msgSender,
        to: zeroAddress,
        amount: totalPostFeeAmounts,
      });
      expect(burnEvent.args.from).to.not.equal(zeroAddress);
      validateEvent(
        initiateEvent,
        'InitiateRedemptions(uint256[],uint8,uint256[],address)',
        {
          lockIndexes: lockIndexes.map((l) => toBN(l)),
          f,
          assets,
          receiver,
        }
      );
      expect(initiateEvent.args.to).to.not.equal(zeroAddress);
      validateEvent(
        mintFuturesEvent1,
        'MintFutures(uint256,uint8,uint256,address)',
        {
          rounds: expectedRewardsRounds1,
          f,
          assets: assets[0],
          receiver,
        }
      );
      validateEvent(
        mintFuturesEvent2,
        'MintFutures(uint256,uint8,uint256,address)',
        {
          rounds: expectedRewardsRounds2,
          f,
          assets: assets[1],
          receiver,
        }
      );
      validateEvent(
        pirexFeesApprovalEvent,
        'Approval(address,address,uint256)',
        {
          owner: msgSender,
          spender: pirexFees.address,
          amount: totalFeeAmounts,
        }
      );
      expect(pirexFeesApprovalEvent.args.owner).to.not.equal(zeroAddress);
      expect(pirexFeesApprovalEvent.args.spender).to.not.equal(zeroAddress);
      expect(pirexFeesApprovalEvent.args.value).to.not.equal(0);
      validateEvent(
        treasuryFeeTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: msgSender,
          to: await pirexFees.treasury(),
          amount: totalFeeAmounts
            .mul(feeTreasuryPercent)
            .div(feePercentDenominator),
        }
      );
      validateEvent(
        contributorsFeeTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: msgSender,
          to: await pirexFees.contributors(),
          amount: totalFeeAmounts
            .mul(feeContributorPercent)
            .div(feePercentDenominator),
        }
      );
      expect(
        every(rpxCvxBalances1, (v, i) => {
          let bal = toBN(0);

          if (expectedRewardsRounds1.gte(i + 1)) {
            bal = bal.add(assets[0]);
          }

          if (expectedRewardsRounds2.gte(i + 1)) {
            bal = bal.add(assets[1]);
          }

          return v.eq(bal);
        })
      ).to.equal(true);
      expect(
        every(rpxCvxBalances2, (v, i) => {
          let bal = toBN(0);

          if (expectedRewardsRounds1.gte(i + 1)) {
            bal = bal.add(assets[0]);
          }

          if (expectedRewardsRounds2.gte(i + 1)) {
            bal = bal.add(assets[1]);
          }

          return v.eq(bal);
        })
      ).to.equal(true);
    });

    it('Should revert if insufficient redemption allowance', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pirexCvx.address);
      const lockIndexes = [1];
      const { unlockTime } = lockData[lockIndexes[0]];
      const redemptions = await pirexCvx.redemptions(unlockTime);
      const f = futuresEnum.reward;
      const invalidAssets = [
        lockData[lockIndexes[0]].amount
          .sub(redemptions)
          .add(1)
          .mul(105)
          .div(100),
      ];
      const receiver = admin.address;

      await expect(
        pirexCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });
  });

  describe('redeem', function () {
    let upxCvxBalance1: BigNumber;
    let upxCvxBalance2: BigNumber;

    before(async function () {
      const upxCvx = await this.getUpxCvx(await pirexCvx.upxCvx());

      upxCvxBalance1 = await upxCvx.balanceOf(
        admin.address,
        redemptionUnlockTime1
      );
      upxCvxBalance2 = await upxCvx.balanceOf(
        admin.address,
        redemptionUnlockTime2
      );
    });

    it('Should revert if unlockTimes is an empty array', async function () {
      const invalidUnlockTimes: any = [];
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pirexCvx.redeem(invalidUnlockTimes, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if unlockTimes and assets have mismatched lengths', async function () {
      const unlockTimes = [redemptionUnlockTime1, redemptionUnlockTime2];
      const assets = [upxCvxBalance1];
      const receiver = admin.address;

      await expect(
        pirexCvx.redeem(unlockTimes, assets, receiver)
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('Should make multiple redemptions', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const unlockTimes = [redemptionUnlockTime1, redemptionUnlockTime2];
      const assets = [upxCvxBalance1.div(2), upxCvxBalance2.div(2)];
      const receiver = admin.address;
      const outstandingRedemptionsBefore = await pirexCvx.outstandingRedemptions();
      const upxCvx = await this.getUpxCvx(await pirexCvx.upxCvx());

      await increaseBlockTimestamp(
        Number(redemptionUnlockTime2.sub(timestamp).add(1))
      );

      await upxCvx.setApprovalForAll(pirexCvx.address, true);

      const upxCvxBalanceBefore1 = await upxCvx.balanceOf(
        admin.address,
        unlockTimes[0]
      );
      const upxCvxBalanceBefore2 = await upxCvx.balanceOf(
        admin.address,
        unlockTimes[1]
      );
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const events = await callAndReturnEvents(pirexCvx.redeem, [
        unlockTimes,
        assets,
        receiver,
      ]);
      const redeemEvent = events[0];
      const cvxTransferEvent = parseLog(pxCvx, events[14]);
      const outstandingRedemptionsAfter = await pirexCvx.outstandingRedemptions();
      const totalAssets = assets[0].add(assets[1]);
      const upxCvxBalanceAfter1 = await upxCvx.balanceOf(
        admin.address,
        unlockTimes[0]
      );
      const upxCvxBalanceAfter2 = await upxCvx.balanceOf(
        admin.address,
        unlockTimes[1]
      );
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);

      expect(upxCvxBalanceAfter1).to.equal(upxCvxBalanceBefore1.sub(assets[0]));
      expect(upxCvxBalanceAfter2).to.equal(upxCvxBalanceBefore2.sub(assets[1]));
      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(totalAssets));
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.sub(totalAssets)
      );
      validateEvent(redeemEvent, 'Redeem(uint256[],uint256[],address,bool)', {
        unlockTimes,
        assets,
        receiver,
        legacy: false,
      });
      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pirexCvx.address,
        to: receiver,
        amount: totalAssets,
      });

      await pirexCvx.redeem(unlockTimes, [toBN(1), toBN(1)], admin.address);
    });
  });

  describe('stake', function () {
    it('Should revert if rounds is zero', async function () {
      const invalidRounds = 0;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pirexCvx.stake(invalidRounds, f, assets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if futures enum is out of range', async function () {
      const rounds = 1;
      const invalidF = futuresEnum.reward + 1;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pirexCvx.stake(rounds, invalidF, assets, receiver)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if assets is zero', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const invalidAssets = 0;
      const receiver = admin.address;

      await expect(
        pirexCvx.stake(rounds, f, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if to is zero address', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;

      await expect(
        pirexCvx.stake(rounds, f, assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if pxCVX balance is insufficient', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await pxCvx.transfer(
        notAdmin.address,
        await pxCvx.balanceOf(admin.address)
      );

      await expect(pirexCvx.stake(rounds, f, assets, receiver)).to.be.revertedWith(
        '0x11'
      );

      // Transfer funds back
      await pxCvx
        .connect(notAdmin)
        .transfer(admin.address, await pxCvx.balanceOf(notAdmin.address));
    });

    it('should revert if the contract is paused', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await pirexCvx.setPauseState(true);

      await expect(pirexCvx.stake(rounds, f, assets, receiver)).to.be.revertedWith(
        'Pausable: paused'
      );

      await pirexCvx.setPauseState(false);
    });

    it('Should stake pxCVX', async function () {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const rounds = toBN(255);
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;
      const spxCvx = await this.getSpxCvx(await pirexCvx.spxCvx());

      // Redeem pxCVX from unionPirex vault
      await unionPirex.redeem(assets, admin.address, admin.address);

      const pxCvxBalanceBefore = await pxCvx.balanceOf(admin.address);

      // Expected values post-transfer
      const expectedPxCvxBalance = pxCvxBalanceBefore.sub(assets);

      // Expected values post-initialize
      const expectedStakeExpiry = currentEpoch.add(rounds.mul(epochDuration));

      // Store stake expiry for later testing
      stakeExpiry = expectedStakeExpiry;

      const spxCvxBalanceBefore = await spxCvx.balanceOf(
        receiver,
        expectedStakeExpiry
      );
      const events = await callAndReturnEvents(pirexCvx.stake, [
        rounds,
        f,
        assets,
        receiver,
      ]);
      const burnEvent = parseLog(pxCvx, events[0]);
      const stakeEvent = events[1];
      const mintFuturesEvent = events[3];
      const rpxCvxBalances = await this.getFuturesCvxBalances(
        Number(rounds),
        f,
        currentEpoch
      );
      const spxCvxBalanceAfter = await spxCvx.balanceOf(
        receiver,
        expectedStakeExpiry
      );
      const pxCvxBalanceAfter = await pxCvx.balanceOf(admin.address);

      expect(expectedPxCvxBalance).to.equal(pxCvxBalanceAfter);
      expect(expectedStakeExpiry).to.not.equal(0);
      expect(spxCvxBalanceAfter).to.equal(spxCvxBalanceBefore.add(assets));
      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: zeroAddress,
        amount: assets,
      });
      validateEvent(stakeEvent, 'Stake(uint256,uint8,uint256,address)', {
        rounds,
        f,
        assets,
        receiver,
      });
      validateEvent(
        mintFuturesEvent,
        'MintFutures(uint256,uint8,uint256,address)',
        {
          rounds,
          f,
          assets,
          receiver,
        }
      );
      expect(rpxCvxBalances.length).to.equal(rounds);
      expect(every(rpxCvxBalances, (r) => r.eq(assets))).to.equal(true);
    });
  });

  describe('unstake', function () {
    it('Should revert if id is less than timestamp', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const invalidId = toBN(timestamp).add(10000);
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pirexCvx.unstake(invalidId, assets, receiver)
      ).to.be.revertedWith('BeforeStakingExpiry()');
    });

    it('Should revert if amount is zero', async function () {
      const id = 0;
      const invalidAssets = 0;
      const receiver = admin.address;

      await expect(
        pirexCvx.unstake(id, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const id = 0;
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;

      await expect(
        pirexCvx.unstake(id, assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if spxCVX balance is insufficient', async function () {
      const spxCvx = await this.getSpxCvx(await pirexCvx.spxCvx());
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(Number(stakeExpiry.sub(timestamp)));

      const id = stakeExpiry;
      const receiver = admin.address;
      const spxCvxBalance = await spxCvx.balanceOf(admin.address, stakeExpiry);
      const emptyByteString = ethers.utils.solidityKeccak256(['string'], ['']);

      // Transfer funds to trigger insufficient balance error
      await spxCvx.safeTransferFrom(
        admin.address,
        notAdmin.address,
        stakeExpiry,
        1,
        emptyByteString
      );

      const invalidAssets = spxCvxBalance;

      // Approve burn
      await spxCvx.setApprovalForAll(pirexCvx.address, true);

      await expect(
        pirexCvx.unstake(id, invalidAssets, receiver)
      ).to.be.revertedWith('0x11');

      // Transfer funds back
      await spxCvx
        .connect(notAdmin)
        .safeTransferFrom(
          notAdmin.address,
          admin.address,
          stakeExpiry,
          1,
          emptyByteString
        );
    });

    it('should revert if the contract is paused', async function () {
      const spxCvx = await this.getSpxCvx(await pirexCvx.spxCvx());
      const id = stakeExpiry;
      const receiver = admin.address;
      const spxCvxBalance = await spxCvx.balanceOf(admin.address, stakeExpiry);

      await pirexCvx.setPauseState(true);

      await expect(pirexCvx.unstake(id, spxCvxBalance, receiver)).to.be.revertedWith(
        'Pausable: paused'
      );

      await pirexCvx.setPauseState(false);
    });

    it('Should unstake pxCVX', async function () {
      const spxCvx = await this.getSpxCvx(await pirexCvx.spxCvx());
      const id = stakeExpiry;
      const assets = await spxCvx.balanceOf(admin.address, stakeExpiry);
      const receiver = admin.address;
      const pxCvxBalanceBefore = await pxCvx.balanceOf(receiver);
      const spxCvxBalance = await spxCvx.balanceOf(admin.address, stakeExpiry);

      // Expected pxCVX balance post-unstake
      const expectedPxCvxBalance = pxCvxBalanceBefore.add(spxCvxBalance);
      const expectedSpxCvxBalance = spxCvxBalance.sub(assets);

      const events = await callAndReturnEvents(pirexCvx.unstake, [
        id,
        assets,
        receiver,
      ]);
      const mintEvent = parseLog(pxCvx, events[0]);
      const unstakeEvent = events[1];
      const pxCvxBalanceAfter = await pxCvx.balanceOf(receiver);
      const spxCvxBalanceAfter = await spxCvx.balanceOf(
        admin.address,
        stakeExpiry
      );

      expect(expectedPxCvxBalance).to.equal(pxCvxBalanceAfter);
      expect(expectedPxCvxBalance).to.not.equal(0);
      expect(expectedSpxCvxBalance).to.equal(spxCvxBalanceAfter);
      expect(expectedSpxCvxBalance).to.equal(0);
      validateEvent(mintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: receiver,
        amount: assets,
      });
      validateEvent(unstakeEvent, 'Unstake(uint256,uint256,address)', {
        id,
        assets,
        receiver,
      });
    });
  });
});
