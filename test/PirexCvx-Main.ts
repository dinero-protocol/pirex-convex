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
  UnionPirexVault,
} from '../typechain-types';

// Tests the actual deposit flow (deposit, stake/unstake, redeem...)
describe('PirexCvx-Main', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let unionPirex: UnionPirexVault;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;

  let zeroAddress: string;
  let redemptionUnlockTime: number;
  let epochDuration: BigNumber;

  let futuresEnum: any;
  let feesEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      pCvx,
      unionPirex,
      cvx,
      cvxLocker,
      zeroAddress,
      redemptionUnlockTime,
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
        'ZeroAddress()'
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
      const lockedBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const unionTotalAssetsBefore = await unionPirex.totalAssets();
      const ppCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const to = admin.address;
      const depositAmount = toBN(10e18);

      // Necessary since pCVX transfers CVX to itself before locking
      await cvx.approve(pCvx.address, depositAmount);

      const events = await callAndReturnEvents(pCvx.deposit, [
        to,
        depositAmount,
      ]);
      const pCvxMintEvent = events[0];
      const depositEvent = events[1];
      const approvalEvent = events[2];
      const pCvxTransferEvent = events[4];
      const vaultMintEvent = events[5];
      const cvxTransferEvent = events[7];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const lockedBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);
      const unionTotalAssetsAfter = await unionPirex.totalAssets();
      const ppCvxBalanceAfter = await unionPirex.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(depositAmount));
      expect(lockedBalanceAfter).to.equal(
        lockedBalanceBefore.add(depositAmount)
      );
      expect(ppCvxBalanceAfter).to.equal(ppCvxBalanceBefore.add(depositAmount));
      expect(unionTotalAssetsAfter).to.equal(
        unionTotalAssetsBefore.add(depositAmount)
      );
      validateEvent(pCvxMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: pCvx.address,
        value: depositAmount,
      });

      validateEvent(depositEvent, 'Deposit(address,uint256)', {
        to,
        shares: depositAmount,
      });

      validateEvent(approvalEvent, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: unionPirex.address,
        value: depositAmount,
      });

      validateEvent(pCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: unionPirex.address,
        value: depositAmount,
      });

      validateEvent(vaultMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: admin.address,
        value: depositAmount,
      });

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
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
      await increaseBlockTimestamp(Number(epochDuration));

      const depositAmount = toBN(1e18);

      await cvx.approve(pCvx.address, depositAmount);
      await pCvx.deposit(admin.address, depositAmount);

      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);

      console.log(lockData);

      const lockIndex = 1;
      const to = admin.address;
      const invalidAmount = lockData[lockIndex].amount.add(toBN(1e18));
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
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if pCvx balance is insufficient', async function () {
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
      const lockIndex = 1;
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
      const ppCvxBalanceBefore = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const msgSender = admin.address;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await unionPirex.redeem(redemptionAmount, msgSender, msgSender);

      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pCvx.initiateRedemption, [
        lockIndex,
        to,
        redemptionAmount,
        f,
      ]);
      const burnEvent = events[8];
      const initiateEvent = events[9];
      const mintFuturesEvent = events[11];
      const ppCvxBalanceAfter = await unionPirex.balanceOf(admin.address);
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const remainingTime = toBN(unlockTime).sub(timestampAfter);
      const feeMin = toBN(await pCvx.fees(feesEnum.redemptionMin));
      const feeMax = toBN(await pCvx.fees(feesEnum.redemptionMax));
      const maxRedemptionTime = await pCvx.MAX_REDEMPTION_TIME();
      const feeDenominator = await pCvx.FEE_DENOMINATOR();
      const feePercent = feeMax.sub(
        feeMax.sub(feeMin).mul(remainingTime).div(maxRedemptionTime)
      );
      const feeAmount = redemptionAmount.mul(feePercent).div(feeDenominator);
      const postFeeAmount = redemptionAmount.sub(feeAmount);
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

      expect(ppCvxBalanceAfter).to.equal(
        ppCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.add(postFeeAmount)
      );
      expect(upCvxBalanceAfter).to.equal(upCvxBalanceBefore.add(postFeeAmount));
      validateEvent(burnEvent, 'Transfer(address,address,uint256)', {
        from: msgSender,
        to: zeroAddress,
        value: postFeeAmount,
      });
      expect(burnEvent.args.from).to.not.equal(zeroAddress);
      validateEvent(
        initiateEvent,
        'InitiateRedemption(address,address,uint256,uint256,uint256,uint256)',
        {
          sender: admin.address,
          to,
          amount: redemptionAmount,
          unlockTime,
          postFeeAmount,
          feeAmount,
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
      expect(every(rpCvxBalances, (v) => v.eq(redemptionAmount))).to.equal(
        true
      );
    });

    it('Should revert if insufficient redemption allowance', async function () {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 1;
      const { unlockTime } = lockData[lockIndex];
      const redemptions = await pCvx.redemptions(unlockTime);
      const to = admin.address;
      const invalidAmount = lockData[lockIndex].amount
        .sub(redemptions)
        .add(1)
        .mul(105)
        .div(100);
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
      const upCvx = await this.getUpCvx(await pCvx.upCvx());
      const upCvxBalance = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime
      );
      const invalidTo = zeroAddress;
      const amount = upCvxBalance;

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
        'ZeroAddress()'
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
      const ppCvxBalanceBefore = await unionPirex.balanceOf(admin.address);

      // Expected values post-transfer
      const expectedPCvxBalance = ppCvxBalanceBefore.sub(amount);

      // Expected values post-initialize
      const expectedStakeExpiry = currentEpoch.add(rounds.mul(epochDuration));
      const expectedUnderlyingBalance = amount;
      const expectedShareBalance = amount;

      await unionPirex.redeem(amount, admin.address, admin.address);

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
      const ppCvxBalanceAfter = await unionPirex.balanceOf(admin.address);
      const stakeExpiry = await spCvxInstance.stakeExpiry();
      const underlyingBalance = await pCvx.balanceOf(spCvxInstance.address);
      const shareBalance = await spCvxInstance.balanceOf(to);

      expect(expectedPCvxBalance).to.equal(ppCvxBalanceAfter);
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
