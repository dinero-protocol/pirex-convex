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
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  PirexCvx,
  PirexFees,
  UnionPirexVault,
} from '../typechain-types';

// Tests the actual deposit flow (deposit, stake/unstake, redeem...)
describe('PirexCvx-Main', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let unionPirex: UnionPirexVault;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;

  let zeroAddress: string;
  let redemptionUnlockTime1: BigNumber;
  let redemptionUnlockTime2: BigNumber;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;
  let stakeExpiry: BigNumber;

  before(async function () {
    ({
      admin,
      notAdmin,
      pCvx,
      pirexFees,
      unionPirex,
      cvx,
      cvxLocker,
      zeroAddress,
      redemptionUnlockTime1,
      epochDuration,
      futuresEnum,
      feesEnum,
    } = this);
  });

  describe('deposit', function () {
    it('Should revert if assets is zero', async function () {
      const invalidAssets = toBN(0);
      const receiver = admin.address;
      const shouldCompound = true;

      await expect(
        pCvx.deposit(invalidAssets, receiver, shouldCompound)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;
      const shouldCompound = true;

      await expect(
        pCvx.deposit(assets, invalidReceiver, shouldCompound)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if sender asset balance is insufficient', async function () {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const invalidAssets = cvxBalance.add(1);
      const receiver = admin.address;
      const shouldCompound = true;

      await expect(
        pCvx.deposit(invalidAssets, receiver, shouldCompound)
      ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });

    it('should revert if the contract is paused', async function () {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const receiver = admin.address;
      const shouldCompound = true;

      await pCvx.setPauseState(true);

      await expect(
        pCvx.deposit(cvxBalance, receiver, shouldCompound)
      ).to.be.revertedWith('Pausable: paused');

      await pCvx.setPauseState(false);
    });

    it('Should deposit CVX', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const lockedBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const unionTotalAssetsBefore = await unionPirex.totalAssets();
      const pCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const assets = toBN(10e18);
      const receiver = admin.address;
      const shouldCompound = true;

      // Necessary since pCVX transfers CVX to itself before locking
      await cvx.approve(pCvx.address, assets);

      const events = await callAndReturnEvents(pCvx.deposit, [
        assets,
        receiver,
        shouldCompound,
      ]);
      const pCvxMintEvent = events[0];
      const depositEvent = events[1];
      const approvalEvent = events[2];
      const pCvxTransferApprovalEvent = events[3];
      const pCvxTransferEvent = events[4];
      const vaultMintEvent = events[5];
      const cvxTransferEvent = events[7];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const lockedBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);
      const unionTotalAssetsAfter = await unionPirex.totalAssets();
      const pCvxBalanceAfter = await unionPirex.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(assets));
      expect(lockedBalanceAfter).to.equal(lockedBalanceBefore.add(assets));
      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.add(assets));
      expect(unionTotalAssetsAfter).to.equal(
        unionTotalAssetsBefore.add(assets)
      );
      validateEvent(pCvxMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: pCvx.address,
        value: assets,
      });

      validateEvent(depositEvent, 'Deposit(uint256,address,bool)', {
        assets,
        receiver,
      });

      validateEvent(approvalEvent, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: unionPirex.address,
        value: assets,
      });

      validateEvent(
        pCvxTransferApprovalEvent,
        'Approval(address,address,uint256)',
        {
          owner: pCvx.address,
          spender: unionPirex.address,
          value: 0,
        }
      );

      validateEvent(pCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: unionPirex.address,
        value: assets,
      });

      validateEvent(vaultMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: admin.address,
        value: assets,
      });

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: pCvx.address,
        value: assets,
      });
    });
  });

  describe('initiateRedemptions', function () {
    before(async () => {
      const amount = toBN(1e18);

      await cvx.approve(pCvx.address, amount);
      await pCvx.deposit(amount, admin.address, false);
    });

    it('Should revert if lockIndexes is an empty array', async function () {
      const invalidLockIndexes: any = [];
      const f = futuresEnum.reward;
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pCvx.initiateRedemptions(invalidLockIndexes, f, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if lockIndexes is out of bounds', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const invalidLockIndexes = [lockData.length + 1];
      const f = futuresEnum.reward;
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pCvx.initiateRedemptions(invalidLockIndexes, f, assets, receiver)
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
        pCvx.initiateRedemptions(lockIndexes, invalidF, assets, to)
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
        pCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const assets = [toBN(1)];
      const invalidReceiver = zeroAddress;

      await expect(
        pCvx.initiateRedemptions(lockIndexes, f, assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if redemption exceeds amount of CVX being unlocked', async function () {
      await increaseBlockTimestamp(Number(epochDuration));

      const assets = toBN(1e18);

      await cvx.approve(pCvx.address, assets);
      await pCvx.deposit(assets, admin.address, true);

      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndexes = [1];
      const f = futuresEnum.reward;
      const invalidAssets = [lockData[lockIndexes[0]].amount.add(assets)];
      const receiver = admin.address;

      expect(lockData[lockIndexes[0]].amount.lt(invalidAssets[0])).is.true;
      await expect(
        pCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });

    it('Should revert if pCvx balance is insufficient', async function () {
      const pCvxBalance = await pCvx.balanceOf(notAdmin.address);
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const invalidAssets = [pCvxBalance.add(1)];
      const receiver = admin.address;

      expect(pCvxBalance.lt(invalidAssets[0])).to.equal(true);
      await expect(
        pCvx
          .connect(notAdmin)
          .initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('should revert if the contract is paused', async function () {
      const lockIndexes = [0];
      const f = futuresEnum.reward;
      const assets = [await pCvx.balanceOf(notAdmin.address)];
      const receiver = admin.address;

      await pCvx.setPauseState(true);

      await expect(
        pCvx.initiateRedemptions(lockIndexes, f, assets, receiver)
      ).to.be.revertedWith('Pausable: paused');

      await pCvx.setPauseState(false);
    });

    it('Should initiate multiple redemptions', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndexes = [0, 1];
      const { unlockTime: unlockTime1 } = lockData[lockIndexes[0]];
      const { unlockTime: unlockTime2 } = lockData[lockIndexes[1]];

      redemptionUnlockTime1 = toBN(unlockTime1);
      redemptionUnlockTime2 = toBN(unlockTime2);

      const upCvx = await this.getUpCvx(await pCvx.upCvx());
      const currentEpoch = await pCvx.getCurrentEpoch();
      const pCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxBalanceBefore1 = await upCvx.balanceOf(
        admin.address,
        unlockTime1
      );
      const upCvxBalanceBefore2 = await upCvx.balanceOf(
        admin.address,
        unlockTime2
      );
      const msgSender = admin.address;
      const assets = [toBN(1e18), toBN(1e18)];
      const receiver = admin.address;

      await unionPirex.redeem(assets[0].add(assets[1]), msgSender, msgSender);

      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pCvx.initiateRedemptions, [
        lockIndexes,
        f,
        assets,
        receiver,
      ]);
      const initiateEvent = events[0];
      const mintFuturesEvent1 = events[2];
      const mintFuturesEvent2 = events[5];
      const burnEvent = events[7];
      const pirexFeesApprovalEvent = events[8];
      const treasuryFeeTransferEvent = events[11];
      const contributorsFeeTransferEvent = events[13];
      const pCvxBalanceAfter = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxBalanceAfter1 = await upCvx.balanceOf(
        admin.address,
        unlockTime1
      );
      const upCvxBalanceAfter2 = await upCvx.balanceOf(
        admin.address,
        unlockTime2
      );
      const remainingTime1 = toBN(unlockTime1).sub(timestamp);
      const remainingTime2 = toBN(unlockTime2).sub(timestamp);
      const feeMin = toBN(await pCvx.fees(feesEnum.redemptionMin));
      const feeMax = toBN(await pCvx.fees(feesEnum.redemptionMax));
      const maxRedemptionTime = await pCvx.MAX_REDEMPTION_TIME();
      const feeDenominator = await pCvx.FEE_DENOMINATOR();
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
      const rpCvxBalances1 = await this.getFuturesCvxBalances(
        Number(expectedRewardsRounds1),
        futuresEnum.reward,
        currentEpoch
      );
      const rpCvxBalances2 = await this.getFuturesCvxBalances(
        Number(expectedRewardsRounds2),
        futuresEnum.reward,
        currentEpoch
      );
      const totalAssets = assets[0].add(assets[1]);
      const totalFeeAmounts = feeAmount1.add(feeAmount2);
      const totalPostFeeAmounts = postFeeAmount1.add(postFeeAmount2);

      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.sub(totalAssets));
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.add(totalPostFeeAmounts)
      );
      expect(upCvxBalanceAfter1).to.equal(
        upCvxBalanceBefore1.add(postFeeAmount1)
      );
      expect(upCvxBalanceAfter2).to.equal(
        upCvxBalanceBefore2.add(postFeeAmount2)
      );
      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: msgSender,
        to: zeroAddress,
        value: totalPostFeeAmounts,
      });
      expect(burnEvent.args.from).to.not.equal(zeroAddress);
      validateEvent(
        initiateEvent,
        'InitiateRedemptions(uint256[],uint8,uint256[],address)',
        {
          lockIndexes: lockIndexes.map(l => toBN(l)),
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
      validateEvent(pirexFeesApprovalEvent, 'Approval(address,address,uint256)', {
        owner: msgSender,
        spender: pirexFees.address,
        value: totalFeeAmounts,
      });
      expect(pirexFeesApprovalEvent.args.owner).to.not.equal(zeroAddress);
      expect(pirexFeesApprovalEvent.args.spender).to.not.equal(zeroAddress);
      expect(pirexFeesApprovalEvent.args.value).to.not.equal(0);
      validateEvent(
        treasuryFeeTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: msgSender,
          to: await pirexFees.treasury(),
          value: totalFeeAmounts
            .mul(await pirexFees.treasuryPercent())
            .div(await pirexFees.PERCENT_DENOMINATOR()),
        }
      );
      validateEvent(
        contributorsFeeTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: msgSender,
          to: await pirexFees.contributors(),
          value: totalFeeAmounts
            .mul(await pirexFees.contributorsPercent())
            .div(await pirexFees.PERCENT_DENOMINATOR()),
        }
      );
      expect(
        every(rpCvxBalances1, (v, i) => {
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
        every(rpCvxBalances2, (v, i) => {
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
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndexes = [1];
      const { unlockTime } = lockData[lockIndexes[0]];
      const redemptions = await pCvx.redemptions(unlockTime);
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
        pCvx.initiateRedemptions(lockIndexes, f, invalidAssets, receiver)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });
  });

  describe('redeem', function () {
    let upCvxBalance1: BigNumber;
    let upCvxBalance2: BigNumber;

    before(async function () {
      const upCvx = await this.getUpCvx(await pCvx.upCvx());

      upCvxBalance1 = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime1
      );
      upCvxBalance2 = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime2
      );
    });

    it('Should revert if unlockTimes is an empty array', async function () {
      const invalidUnlockTimes: any = [];
      const assets = [toBN(1e18)];
      const receiver = admin.address;

      await expect(
        pCvx.redeem(invalidUnlockTimes, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if unlockTimes and assets have mismatched lengths', async function () {
      const unlockTimes = [redemptionUnlockTime1, redemptionUnlockTime2];
      const assets = [upCvxBalance1];
      const receiver = admin.address;

      await expect(
        pCvx.redeem(unlockTimes, assets, receiver)
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('Should make multiple redemptions', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const unlockTimes = [redemptionUnlockTime1, redemptionUnlockTime2];
      const assets = [upCvxBalance1, upCvxBalance2];
      const receiver = admin.address;
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvx = await this.getUpCvx(await pCvx.upCvx());

      await increaseBlockTimestamp(
        Number(redemptionUnlockTime2.sub(timestamp).add(1))
      );

      await upCvx.setApprovalForAll(pCvx.address, true);

      const events = await callAndReturnEvents(pCvx.redeem, [
        unlockTimes,
        assets,
        receiver,
      ]);
      const redeemEvent = events[0];
      const cvxTransferEvent1 = events[14];
      const cvxTransferEvent2 = events[16];
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const totalAssets = assets.reduce((acc, val) => acc.add(val), toBN(0));

      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.sub(totalAssets)
      );
      validateEvent(redeemEvent, 'Redeem(uint256[],uint256[],address)', {
        unlockTimes,
        assets,
        receiver,
      });
      validateEvent(cvxTransferEvent1, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        value: assets[0],
      });
      validateEvent(cvxTransferEvent2, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: receiver,
        value: assets[1],
      });
    });
  });

  describe('stake', function () {
    it('Should revert if rounds is zero', async function () {
      const invalidRounds = 0;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pCvx.stake(invalidRounds, f, assets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if futures enum is out of range', async function () {
      const rounds = 1;
      const invalidF = futuresEnum.reward + 1;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pCvx.stake(rounds, invalidF, assets, receiver)
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
        pCvx.stake(rounds, f, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if to is zero address', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;

      await expect(
        pCvx.stake(rounds, f, assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if pCVX balance is insufficient', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await pCvx.transfer(
        notAdmin.address,
        await pCvx.balanceOf(admin.address)
      );

      await expect(pCvx.stake(rounds, f, assets, receiver)).to.be.revertedWith(
        'ERC20: burn amount exceeds balance'
      );

      // Transfer funds back
      await pCvx
        .connect(notAdmin)
        .transfer(admin.address, await pCvx.balanceOf(notAdmin.address));
    });

    it('should revert if the contract is paused', async function () {
      const rounds = 1;
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;

      await pCvx.setPauseState(true);

      await expect(pCvx.stake(rounds, f, assets, receiver)).to.be.revertedWith(
        'Pausable: paused'
      );

      await pCvx.setPauseState(false);
    });

    it('Should stake pCVX', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const rounds = toBN(255);
      const f = futuresEnum.reward;
      const assets = toBN(1e18);
      const receiver = admin.address;
      const spCvx = await this.getSpCvx(await pCvx.spCvx());

      // Redeem pCVX from unionPirex vault
      await unionPirex.redeem(assets, admin.address, admin.address);

      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);

      // Expected values post-transfer
      const expectedPCvxBalance = pCvxBalanceBefore.sub(assets);

      // Expected values post-initialize
      const expectedStakeExpiry = currentEpoch.add(rounds.mul(epochDuration));

      // Store stake expiry for later testing
      stakeExpiry = expectedStakeExpiry;

      const spCvxBalanceBefore = await spCvx.balanceOf(
        receiver,
        expectedStakeExpiry
      );
      const events = await callAndReturnEvents(pCvx.stake, [
        rounds,
        f,
        assets,
        receiver,
      ]);
      const burnEvent = events[0];
      const stakeEvent = events[1];
      const mintFuturesEvent = events[3];
      const rpCvxBalances = await this.getFuturesCvxBalances(
        Number(rounds),
        f,
        currentEpoch
      );
      const spCvxBalanceAfter = await spCvx.balanceOf(
        receiver,
        expectedStakeExpiry
      );
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedStakeExpiry).to.not.equal(0);
      expect(spCvxBalanceAfter).to.equal(spCvxBalanceBefore.add(assets));
      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: zeroAddress,
        value: assets,
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
      expect(rpCvxBalances.length).to.equal(rounds);
      expect(every(rpCvxBalances, (r) => r.eq(assets))).to.equal(true);
    });
  });

  describe('unstake', function () {
    it('Should revert if id is less than timestamp', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const invalidId = toBN(timestamp).add(10000);
      const assets = toBN(1e18);
      const receiver = admin.address;

      await expect(
        pCvx.unstake(invalidId, assets, receiver)
      ).to.be.revertedWith('BeforeStakingExpiry()');
    });

    it('Should revert if amount is zero', async function () {
      const id = 0;
      const invalidAssets = 0;
      const receiver = admin.address;

      await expect(
        pCvx.unstake(id, invalidAssets, receiver)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if receiver is zero address', async function () {
      const id = 0;
      const assets = toBN(1e18);
      const invalidReceiver = zeroAddress;

      await expect(
        pCvx.unstake(id, assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if spCVX balance is insufficient', async function () {
      const spCvx = await this.getSpCvx(await pCvx.spCvx());
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(Number(stakeExpiry.sub(timestamp)));

      const id = stakeExpiry;
      const receiver = admin.address;
      const spCvxBalance = await spCvx.balanceOf(admin.address, stakeExpiry);
      const emptyByteString = ethers.utils.solidityKeccak256(['string'], ['']);

      // Transfer funds to trigger insufficient balance error
      await spCvx.safeTransferFrom(
        admin.address,
        notAdmin.address,
        stakeExpiry,
        1,
        emptyByteString
      );

      const invalidAssets = spCvxBalance;

      // Approve burn
      await spCvx.setApprovalForAll(pCvx.address, true);

      await expect(
        pCvx.unstake(id, invalidAssets, receiver)
      ).to.be.revertedWith('ERC1155: burn amount exceeds balance');

      // Transfer funds back
      await spCvx
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
      const spCvx = await this.getSpCvx(await pCvx.spCvx());
      const id = stakeExpiry;
      const receiver = admin.address;
      const spCvxBalance = await spCvx.balanceOf(admin.address, stakeExpiry);

      await pCvx.setPauseState(true);

      await expect(pCvx.unstake(id, spCvxBalance, receiver)).to.be.revertedWith(
        'Pausable: paused'
      );

      await pCvx.setPauseState(false);
    });

    it('Should unstake pCVX', async function () {
      const spCvx = await this.getSpCvx(await pCvx.spCvx());
      const id = stakeExpiry;
      const assets = await spCvx.balanceOf(admin.address, stakeExpiry);
      const receiver = admin.address;
      const pCvxBalanceBefore = await pCvx.balanceOf(receiver);
      const spCvxBalance = await spCvx.balanceOf(admin.address, stakeExpiry);

      // Expected pCVX balance post-unstake
      const expectedPCvxBalance = pCvxBalanceBefore.add(spCvxBalance);
      const expectedSpCvxBalance = spCvxBalance.sub(assets);

      const events = await callAndReturnEvents(pCvx.unstake, [
        id,
        assets,
        receiver,
      ]);
      const mintEvent = events[0];
      const unstakeEvent = events[1];
      const pCvxBalanceAfter = await pCvx.balanceOf(receiver);
      const spCvxBalanceAfter = await spCvx.balanceOf(
        admin.address,
        stakeExpiry
      );

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedPCvxBalance).to.not.equal(0);
      expect(expectedSpCvxBalance).to.equal(spCvxBalanceAfter);
      expect(expectedSpCvxBalance).to.equal(0);
      validateEvent(mintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: receiver,
        value: assets,
      });
      validateEvent(unstakeEvent, 'Unstake(uint256,uint256,address)', {
        id,
        assets,
        receiver,
      });
    });
  });
});
