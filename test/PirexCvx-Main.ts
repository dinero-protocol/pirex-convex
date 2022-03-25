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
  randomNumberBetweenRange,
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  PirexCvx,
  PirexFees,
} from '../typechain-types';

// Tests the actual deposit flow (deposit, stake/unstake, redeem...)
describe('PirexCvx-Main', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let revenueLockers: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;

  let zeroAddress: string;
  let feeDenominator: number;
  let feePercentDenominator: number;
  let redemptionUnlockTime: number;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      treasury,
      revenueLockers,
      contributors,
      cvx,
      cvxLocker,
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

  describe('deposit', function () {
    it('Should revert if to is zero address', async function () {
      const invalidTo = zeroAddress;
      const depositAmount = toBN(1e18);

      await expect(pCvx.deposit(invalidTo, depositAmount)).to.be.revertedWith(
        'ERC20: mint to the zero address'
      );
    });

    it('Should revert if amount is zero', async function () {
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.deposit(to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if msg.sender CVX balance is insufficient', async function () {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const to = admin.address;
      const invalidAmount = cvxBalance.add(1);

      await expect(pCvx.deposit(to, invalidAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('Should deposit CVX', async function () {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const treasuryCvxBalanceBefore = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceBefore = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceBefore = await cvx.balanceOf(
        contributors.address
      );
      const lockedBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const msgSender = admin.address;
      const to = admin.address;
      const depositAmount = toBN(10e18);
      const depositFee = depositAmount
        .mul(await pCvx.fees(feesEnum.deposit))
        .div(feeDenominator);

      // Necessary since pCVX transfers CVX to itself before locking
      await cvx.approve(pCvx.address, depositAmount);

      const events = await callAndReturnEvents(pCvx.deposit, [
        to,
        depositAmount,
      ]);
      const mintEvent = events[0];
      const depositEvent = events[1];
      const transferEvent = events[2];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const treasuryCvxBalanceAfter = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceAfter = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceAfter = await cvx.balanceOf(
        contributors.address
      );
      const lockedBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const expectedTreasuryFee = depositFee
        .mul(await pirexFees.treasuryPercent())
        .div(feePercentDenominator);
      const expectedRevenueLockersFee = depositFee
        .mul(await pirexFees.revenueLockersPercent())
        .div(feePercentDenominator);
      const expectedContributorsFee = depositFee
        .mul(await pirexFees.contributorsPercent())
        .div(feePercentDenominator);
      const postFeeAmount = depositAmount.sub(depositFee);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(depositAmount));
      expect(treasuryCvxBalanceAfter).to.not.equal(treasuryCvxBalanceBefore);
      expect(treasuryCvxBalanceAfter).to.equal(
        treasuryCvxBalanceBefore.add(expectedTreasuryFee)
      );
      expect(revenueLockersCvxBalanceAfter).to.not.equal(
        revenueLockersCvxBalanceBefore
      );
      expect(revenueLockersCvxBalanceAfter).to.equal(
        revenueLockersCvxBalanceBefore.add(expectedRevenueLockersFee)
      );
      expect(contributorsCvxBalanceAfter).to.not.equal(
        contributorsCvxBalanceBefore
      );
      expect(contributorsCvxBalanceAfter).to.equal(
        contributorsCvxBalanceBefore.add(expectedContributorsFee)
      );
      expect(lockedBalanceAfter).to.equal(
        lockedBalanceBefore.add(postFeeAmount)
      );
      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.add(postFeeAmount));
      validateEvent(mintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to,
        value: postFeeAmount,
      });

      validateEvent(depositEvent, 'Deposit(address,uint256,uint256)', {
        fee: depositFee,
        to,
        shares: postFeeAmount,
      });

      validateEvent(transferEvent, 'Transfer(address,address,uint256)', {
        from: msgSender,
        to: pCvx.address,
        value: depositAmount,
      });
    });
  });

  describe('initiateRedemption', function () {
    it('Should revert if amount is zero', async function () {
      const lockIndex = 0;
      const to = admin.address;
      const invalidAmount = toBN(0);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if amount is greater than Convex unlock amount', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const to = admin.address;
      const invalidAmount = toBN(10e18);
      const f = futuresEnum.reward;

      expect(lockData[lockIndex].amount.lt(invalidAmount)).is.true;
      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });

    it('Should revert if to is zero address', async function () {
      const lockIndex = 0;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, invalidTo, amount, f)
      ).to.be.revertedWith('ERC1155: mint to the zero address');
    });

    it('Should revert if pCvx balance is insufficient', async function () {
      await pCvx.transfer(notAdmin.address, toBN(1e18));

      const pCvxBalance = await pCvx.balanceOf(notAdmin.address);
      const lockIndex = 0;
      const to = admin.address;
      const invalidRedemptionAmount = pCvxBalance.add(1);
      const f = futuresEnum.reward;

      expect(pCvxBalance.lt(invalidRedemptionAmount)).to.equal(true);
      await expect(
        pCvx
          .connect(notAdmin)
          .initiateRedemption(lockIndex, to, invalidRedemptionAmount, f)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('Should revert if futures enum is out of range', async function () {
      const lockIndex = 0;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const invalidF = futuresEnum.reward + 1;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, redemptionAmount, invalidF)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should initiate a redemption', async function () {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const { unlockTime } = lockData[lockIndex];

      redemptionUnlockTime = unlockTime;

      // Increase timestamp between now and unlock time to test futures notes correctness
      await increaseBlockTimestamp(
        randomNumberBetweenRange(0, Number(toBN(unlockTime).sub(timestamp)))
      );

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );
      const upCvx = await this.getUpCvx(await pCvx.upCvx());
      const currentEpoch = await pCvx.getCurrentEpoch();
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const msgSender = admin.address;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pCvx.initiateRedemption, [
        lockIndex,
        to,
        redemptionAmount,
        f,
      ]);
      const burnEvent = events[0];
      const initiateEvent = events[1];
      const mintFuturesEvent = events[3];
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const remainingTime = toBN(unlockTime).sub(timestampAfter);

      let expectedRewardsRounds = remainingTime.div(epochDuration);

      if (
        !toBN(unlockTime).mod(epochDuration).isZero() &&
        remainingTime.lt(epochDuration) &&
        remainingTime.gt(epochDuration.div(2))
      ) {
        expectedRewardsRounds = expectedRewardsRounds.add(1);
      }

      const rpCvxBalances = await this.getFuturesCvxBalances(
        Number(expectedRewardsRounds),
        futuresEnum.reward,
        currentEpoch
      );

      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.add(redemptionAmount)
      );
      expect(upCvxBalanceAfter).to.equal(
        upCvxBalanceBefore.add(redemptionAmount)
      );
      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: msgSender,
        to: zeroAddress,
        value: redemptionAmount,
      });
      expect(burnEvent.args.from).to.not.equal(zeroAddress);
      validateEvent(
        initiateEvent,
        'InitiateRedemption(address,address,uint256,uint256)',
        {
          sender: admin.address,
          to,
          amount: redemptionAmount,
          unlockTime,
        }
      );
      expect(initiateEvent.args.to).to.not.equal(zeroAddress);
      validateEvent(
        mintFuturesEvent,
        'MintFutures(uint8,address,uint256,uint8)',
        {
          rounds: expectedRewardsRounds,
          to,
          amount: redemptionAmount,
          f,
        }
      );
      expect(
        every(
          rpCvxBalances,
          (v) => v.eq(redemptionAmount) && v.eq(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should revert if insufficient redemption allowance', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const { unlockTime } = lockData[lockIndex];
      const redemptions = await pCvx.redemptions(unlockTime);
      const to = admin.address;
      const invalidAmount = lockData[lockIndex].amount.sub(redemptions).add(1);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });
  });

  describe('redeem', function () {
    it('Should revert if before lock expiry', async function () {
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        pCvx.redeem(redemptionUnlockTime, to, amount)
      ).to.be.revertedWith('BeforeUnlock()');
    });

    it('Should revert if amount is zero', async function () {
      const unlockTime = 0;
      const to = admin.address;
      const amount = 0;

      await expect(pCvx.redeem(unlockTime, to, amount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if insufficient upCVX balance for epoch', async function () {
      // Does not exist, should not have a valid token balance
      const invalidUnlockTime = toBN(redemptionUnlockTime).add(1);
      const to = admin.address;
      const amount = toBN(1e18);
      const upCvx = await this.getUpCvx(await pCvx.upCvx());
      const upCvxBalance = await upCvx.balanceOf(
        admin.address,
        invalidUnlockTime
      );
      const { timestamp } = await ethers.provider.getBlock('latest');

      await upCvx.setApprovalForAll(pCvx.address, true);
      await increaseBlockTimestamp(Number(invalidUnlockTime.sub(timestamp)));

      expect(upCvxBalance).to.equal(0);
      await expect(
        pCvx.redeem(invalidUnlockTime, to, amount)
      ).to.be.revertedWith(
        // Caused by ERC1155Supply _beforeTokenTransfer hook
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should revert if to is zero address', async function () {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(
        pCvx.redeem(redemptionUnlockTime, invalidTo, amount)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should redeem CVX', async function () {
      const upCvx = await this.getUpCvx(await pCvx.upCvx());
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime
      );
      const { unlockable: unlockableBefore, locked: lockedBefore } =
        await cvxLocker.lockedBalances(pCvx.address);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxTotalSupplyBefore = await upCvx.totalSupply(
        redemptionUnlockTime
      );
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const to = admin.address;
      const amount = upCvxBalanceBefore.div(2);

      // Expected values post-relock and outstandingRedemptions decrementing
      const expectedRelock = unlockableBefore.sub(outstandingRedemptionsBefore);
      const expectedCvxOutstanding = outstandingRedemptionsBefore.sub(amount);
      const expectedPirexCvxBalance = outstandingRedemptionsBefore.sub(amount);
      const expectedLocked = lockedBefore.add(
        unlockableBefore.sub(outstandingRedemptionsBefore)
      );

      // Expected values post-burn
      const expectedUpCvxSupply = upCvxTotalSupplyBefore.sub(amount);
      const expectedUpCvxBalance = upCvxBalanceBefore.sub(amount);

      // Expected values post-CVX transfer
      const expectedCvxBalance = cvxBalanceBefore.add(amount);

      const events = await callAndReturnEvents(pCvx.redeem, [
        redemptionUnlockTime,
        to,
        amount,
      ]);
      const redeemEvent = events[0];
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime
      );
      const { locked: lockedAfter } = await cvxLocker.lockedBalances(
        pCvx.address
      );
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxTotalSupplyAfter = await upCvx.totalSupply(
        redemptionUnlockTime
      );
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const pirexCvxBalanceAfter = await cvx.balanceOf(pCvx.address);

      expect(expectedRelock).to.equal(lockedAfter.sub(lockedBefore));
      expect(expectedRelock).to.not.equal(0);
      expect(expectedCvxOutstanding).to.equal(outstandingRedemptionsAfter);
      expect(expectedCvxOutstanding).to.not.equal(0);
      expect(expectedPirexCvxBalance).to.equal(pirexCvxBalanceAfter);
      expect(expectedLocked).to.equal(lockedAfter);
      expect(expectedLocked).to.not.equal(0);
      expect(expectedUpCvxSupply).to.equal(upCvxTotalSupplyAfter);
      expect(expectedUpCvxSupply).to.not.equal(0);
      expect(expectedUpCvxBalance).to.equal(upCvxBalanceAfter);
      expect(expectedUpCvxBalance).to.not.equal(0);
      expect(expectedCvxBalance).to.equal(cvxBalanceAfter);
      expect(expectedCvxBalance).to.not.equal(0);
      validateEvent(redeemEvent, 'Redeem(uint256,address,uint256)', {
        epoch: redemptionUnlockTime,
        to,
        amount,
      });
    });
  });

  describe('stake', function () {
    it('Should revert if rounds is zero', async function () {
      const invalidRounds = 0;
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(invalidRounds, to, amount, f)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if to is zero address', async function () {
      const rounds = 1;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(rounds, invalidTo, amount, f)).to.be.revertedWith(
        'ERC20: mint to the zero address'
      );
    });

    it('Should revert if amount is zero', async function () {
      const rounds = 1;
      const to = admin.address;
      const invalidAmount = toBN(0);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(rounds, to, invalidAmount, f)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if futures enum is out of range', async function () {
      const rounds = 1;
      const to = admin.address;
      const amount = toBN(1e18);
      const invalidF = futuresEnum.reward + 1;

      await expect(pCvx.stake(rounds, to, amount, invalidF)).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if pCVX balance is insufficient', async function () {
      const rounds = 1;
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await pCvx.transfer(
        notAdmin.address,
        await pCvx.balanceOf(admin.address)
      );

      await expect(pCvx.stake(rounds, to, amount, f)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );

      // Transfer funds back
      await pCvx
        .connect(notAdmin)
        .transfer(admin.address, await pCvx.balanceOf(notAdmin.address));
    });

    it('Should stake pCVX', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const rounds = toBN(255);
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);

      // Expected values post-transfer
      const expectedPCvxBalance = pCvxBalanceBefore.sub(amount);

      // Expected values post-initialize
      const expectedStakeExpiry = currentEpoch.add(rounds.mul(epochDuration));
      const expectedUnderlyingBalance = amount;
      const expectedShareBalance = amount;

      const events = await callAndReturnEvents(pCvx.stake, [
        rounds,
        to,
        amount,
        f,
      ]);
      const transferEvent = events[0];
      const approveEvent = events[1];
      const stakeEvent = events[2];
      const mintFuturesEvent = events[8];
      const spCvx = await pCvx.getSpCvx();
      const spCvxInstance = await this.getSpCvx(spCvx[spCvx.length - 1]);
      const rpCvxBalances = await this.getFuturesCvxBalances(
        Number(rounds),
        f,
        currentEpoch
      );
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const stakeExpiry = await spCvxInstance.stakeExpiry();
      const underlyingBalance = await pCvx.balanceOf(spCvxInstance.address);
      const shareBalance = await spCvxInstance.balanceOf(to);

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedPCvxBalance).to.not.equal(0);
      expect(expectedStakeExpiry).to.equal(stakeExpiry);
      expect(expectedStakeExpiry).to.not.equal(0);
      expect(expectedUnderlyingBalance).to.equal(underlyingBalance);
      expect(expectedUnderlyingBalance).to.not.equal(0);
      expect(expectedShareBalance).to.equal(shareBalance);
      expect(expectedShareBalance).to.not.equal(0);
      validateEvent(transferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: pCvx.address,
        value: amount,
      });
      validateEvent(approveEvent, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: spCvxInstance.address,
        value: amount,
      });
      validateEvent(stakeEvent, 'Stake(uint8,address,uint256,uint8,address)', {
        rounds,
        to,
        amount,
        f,
        vault: spCvxInstance.address,
      });
      validateEvent(
        mintFuturesEvent,
        'MintFutures(uint8,address,uint256,uint8)',
        {
          rounds,
          to,
          amount,
          f,
        }
      );
      expect(rpCvxBalances.length).to.equal(rounds);
      expect(every(rpCvxBalances, (r) => r.eq(amount))).to.equal(true);
    });
  });

  describe('unstake', function () {
    it('Should revert if vault is zero address', async function () {
      const invalidVault = zeroAddress;
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(pCvx.unstake(invalidVault, to, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if to is zero address', async function () {
      const vault = admin.address;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(pCvx.unstake(vault, invalidTo, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if amount is zero', async function () {
      const vault = admin.address;
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.unstake(vault, to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if shares balance is insufficient', async function () {
      const spCvx = await pCvx.getSpCvx();
      const vault = spCvx[spCvx.length - 1];
      const to = admin.address;
      const spCvxInstance = await this.getSpCvx(vault);
      const spCvxBalance = await spCvxInstance.balanceOf(admin.address);
      const invalidAmount = spCvxBalance.add(1);

      await spCvxInstance.increaseAllowance(pCvx.address, invalidAmount);

      await expect(pCvx.unstake(vault, to, invalidAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('Should revert if before stake expiry', async function () {
      const spCvx = await pCvx.getSpCvx();
      const vault = await this.getSpCvx(spCvx[spCvx.length - 1]);
      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);

      await vault.increaseAllowance(pCvx.address, amount);

      await expect(pCvx.unstake(vault.address, to, amount)).to.be.revertedWith(
        'BeforeStakeExpiry()'
      );
    });

    it('Should unstake pCVX', async function () {
      const spCvx = await pCvx.getSpCvx();
      const vault = await this.getSpCvx(spCvx[spCvx.length - 1]);
      const stakeExpiry = await vault.stakeExpiry();
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(Number(stakeExpiry.sub(timestamp)));

      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(to);
      const vaultShareBalanceBefore = await vault.balanceOf(admin.address);

      // Expected pCVX balance post-unstake
      const expectedPCvxBalance = pCvxBalanceBefore.add(amount);
      const expectedShareBalance = vaultShareBalanceBefore.sub(amount);

      await vault.increaseAllowance(pCvx.address, amount);

      const events = await callAndReturnEvents(pCvx.unstake, [
        vault.address,
        to,
        amount,
      ]);
      const unstakeEvent = events[0];
      const transferEvent = events[2];
      const pCvxBalanceAfter = await pCvx.balanceOf(to);
      const vaultShareBalanceAfter = await vault.balanceOf(admin.address);

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedPCvxBalance).to.not.equal(0);
      expect(expectedShareBalance).to.equal(vaultShareBalanceAfter);
      expect(expectedShareBalance).to.equal(0);
      validateEvent(unstakeEvent, 'Unstake(address,address,uint256)', {
        vault: vault.address,
        to,
        amount,
      });
      validateEvent(transferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: pCvx.address,
        value: amount,
      });
    });
  });
});
