import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import {
  ConvexToken,
  PxCvx,
  PirexCvx,
  UnionPirexVault,
  UnionPirexStrategy,
} from '../typechain-types';
import {
  callAndReturnEvents,
  increaseBlockTimestamp,
  toBN,
  toBN2,
  validateEvent,
} from './helpers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Union', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let pxCvx: PxCvx;
  let unionPirex: UnionPirexVault;
  let unionPirexStrategy: UnionPirexStrategy;
  let unionPirexStrategy2: UnionPirexStrategy;
  let cvx: ConvexToken;
  let zeroAddress: string;
  let contractEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      cvx,
      pCvx,
      pxCvx,
      unionPirex,
      unionPirexStrategy,
      zeroAddress,
      contractEnum,
    } = this);

    if (await pCvx.paused()) await pCvx.setPauseState(false);

    if ((await pCvx.unionPirex()) === zeroAddress) {
      await pCvx.setContract(contractEnum.unionPirex, unionPirex.address);
    }

    // Mint pCVX for testing
    await cvx.approve(pCvx.address, toBN(50e18));
    await pCvx.deposit(toBN(50e18), admin.address, false);

    // For making pxCVX deposits outside of the pCvx.deposit flow
    await pxCvx.approve(unionPirex.address, toBN2(1000e18).toFixed(0));

    unionPirexStrategy2 = await (
      await ethers.getContractFactory('UnionPirexStrategy')
    ).deploy(pCvx.address, pxCvx.address, admin.address, unionPirex.address);
  });

  describe('initial state', function () {
    it('Should have initialized state variables', async function () {
      const MAX_WITHDRAWAL_PENALTY = await unionPirex.MAX_WITHDRAWAL_PENALTY();
      const MAX_PLATFORM_FEE = await unionPirex.MAX_PLATFORM_FEE();
      const FEE_DENOMINATOR = await unionPirex.FEE_DENOMINATOR();
      const withdrawalPenalty = await unionPirex.withdrawalPenalty();
      const platformFee = await unionPirex.platformFee();

      expect(MAX_WITHDRAWAL_PENALTY).to.equal(500);
      expect(MAX_PLATFORM_FEE).to.equal(2000);
      expect(FEE_DENOMINATOR).to.equal(10000);
      expect(withdrawalPenalty).to.equal(300);
      expect(platformFee).to.equal(500);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const strategy = await unionPirex.strategy();
      const asset = await unionPirex.asset();
      const name = await unionPirex.name();
      const symbol = await unionPirex.symbol();

      expect(strategy).to.equal(unionPirexStrategy.address);
      expect(asset).to.equal(pxCvx.address);
      expect(name).to.equal('Union Pirex');
      expect(symbol).to.equal('uCVX');
    });
  });

  describe('setWithdrawalPenalty', function () {
    it('Should revert if withdrawal penalty is greater than max', async function () {
      const max = await unionPirex.MAX_WITHDRAWAL_PENALTY();
      const invalidPenalty = max.add(1);

      await expect(
        unionPirex.setWithdrawalPenalty(invalidPenalty)
      ).to.be.revertedWith('ExceedsMax()');
    });

    it('Should revert if not called by owner', async function () {
      const penalty = toBN(1);

      await expect(
        unionPirex.connect(notAdmin).setWithdrawalPenalty(penalty)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${await unionPirex.DEFAULT_ADMIN_ROLE()}`
      );
    });

    it('Should set withdrawal penalty', async function () {
      const penaltyBefore = await unionPirex.withdrawalPenalty();
      const penalty = toBN(1);
      const events = await callAndReturnEvents(
        unionPirex.setWithdrawalPenalty,
        [penalty]
      );
      const setEvent = events[0];
      const penaltyAfter = await unionPirex.withdrawalPenalty();

      expect(penaltyBefore).to.not.equal(penaltyAfter);
      expect(penaltyAfter).to.equal(penalty);

      validateEvent(setEvent, 'WithdrawalPenaltyUpdated(uint256)', {
        _penalty: penalty,
      });
    });
  });

  describe('setPlatform', function () {
    it('Should revert if platform is zero address', async function () {
      const invalidPlatform = zeroAddress;

      await expect(unionPirex.setPlatform(invalidPlatform)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if not called by owner', async function () {
      const platform = admin.address;

      await expect(
        unionPirex.connect(notAdmin).setPlatform(platform)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${await unionPirex.DEFAULT_ADMIN_ROLE()}`
      );
    });

    it('Should set platform', async function () {
      const platformBefore = await unionPirex.platform();
      const platform = admin.address;
      const events = await callAndReturnEvents(unionPirex.setPlatform, [
        platform,
      ]);
      const setEvent = events[0];
      const platformAfter = await unionPirex.platform();

      expect(platformBefore).to.not.equal(platformAfter);
      expect(platformAfter).to.equal(platform);
      validateEvent(setEvent, 'PlatformUpdated(address)', {
        _platform: platform,
      });
    });
  });

  describe('setStrategy', function () {
    before(async function () {
      const assets = toBN(1e18);

      await cvx.approve(pCvx.address, assets);
      await pCvx.deposit(assets, admin.address, true);
    });

    it('Should revert if _strategy is zero address', async function () {
      const invalidStrategy = zeroAddress;

      await expect(unionPirex.setStrategy(invalidStrategy)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if not called by owner', async function () {
      const strategy = unionPirexStrategy2.address;

      await expect(
        unionPirex.connect(notAdmin).setStrategy(strategy)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${await unionPirex.DEFAULT_ADMIN_ROLE()}`
      );
    });

    it('Should set a new strategy', async function () {
      const getStrategyAllowance = async (strategy: string) =>
        await pxCvx.allowance(unionPirex.address, strategy);
      const oldStrategy = unionPirexStrategy.address;
      const strategy = unionPirexStrategy2.address;
      const oldStrategyBalanceBefore = await unionPirexStrategy.totalSupply();
      const newStrategyBalanceBefore = await unionPirexStrategy2.totalSupply();
      const oldStrategyAllowanceBefore = await getStrategyAllowance(
        oldStrategy
      );
      const newStrategyAllowanceBefore = await getStrategyAllowance(strategy);
      const events = await callAndReturnEvents(unionPirex.setStrategy, [
        strategy,
      ]);
      const newStrategyApprovalEvent = events[0];
      const oldStrategyApprovalEvent = events[1];
      const oldStrategyWithdrawEvent = events[2];
      const newStrategyStakeEvent = events[4];
      const strategySetEvent = events[events.length - 1];
      const oldStrategyBalanceAfter = await unionPirexStrategy.totalSupply();
      const newStrategyBalanceAfter = await unionPirexStrategy2.totalSupply();
      const oldStrategyAllowanceAfter = await getStrategyAllowance(oldStrategy);
      const newStrategyAllowanceAfter = await getStrategyAllowance(strategy);

      expect(oldStrategyBalanceBefore).to.not.equal(newStrategyBalanceBefore);
      expect(newStrategyBalanceBefore).to.equal(0);
      expect(oldStrategyBalanceBefore).to.not.equal(0);
      expect(oldStrategyBalanceAfter).to.not.equal(newStrategyBalanceAfter);
      expect(oldStrategyBalanceAfter).to.equal(0);
      expect(newStrategyBalanceAfter).to.equal(oldStrategyBalanceBefore);
      expect(oldStrategyAllowanceBefore).to.not.equal(
        newStrategyAllowanceBefore
      );
      expect(newStrategyAllowanceBefore).to.equal(0);
      expect(oldStrategyAllowanceAfter).to.not.equal(newStrategyAllowanceAfter);
      expect(oldStrategyAllowanceAfter).to.equal(0);

      // Using `oldStrategyAllowanceBefore` as a proxy for uint256 max
      expect(newStrategyAllowanceAfter).to.equal(oldStrategyAllowanceBefore);

      validateEvent(
        newStrategyApprovalEvent,
        'Approval(address,address,uint256)',
        {
          owner: unionPirex.address,
          spender: unionPirexStrategy2.address,
          amount: oldStrategyAllowanceBefore,
        }
      );

      validateEvent(
        oldStrategyApprovalEvent,
        'Approval(address,address,uint256)',
        {
          owner: unionPirex.address,
          spender: unionPirexStrategy.address,
          amount: 0,
        }
      );

      validateEvent(
        oldStrategyWithdrawEvent,
        'Transfer(address,address,uint256)',
        {
          from: oldStrategy,
          to: unionPirex.address,
          amount: oldStrategyBalanceBefore,
        }
      );

      validateEvent(
        newStrategyStakeEvent,
        'Transfer(address,address,uint256)',
        {
          from: unionPirex.address,
          to: strategy,
          amount: oldStrategyBalanceBefore,
        }
      );

      validateEvent(strategySetEvent, 'StrategySet(address)', {
        _strategy: unionPirexStrategy2.address,
      });
    });
  });

  describe('deposit', function () {
    it('Should revert if assets is zero', async function () {
      const invalidAssets = 0;
      const receiver = admin.address;

      await expect(
        unionPirex.deposit(invalidAssets, receiver)
      ).to.be.revertedWith('ZERO_SHARES');
    });

    it('Should deposit pxCVX', async function () {
      const assets = (await pxCvx.balanceOf(admin.address)).div(10);
      const receiver = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const sharesBefore = await unionPirex.balanceOf(receiver);
      const expectedShares = await unionPirex.previewDeposit(assets);
      const earned = await unionPirexStrategy2.earned();
      const events = await callAndReturnEvents(unionPirex.deposit, [
        assets,
        receiver,
      ]);
      const harvestEvent = events[0];
      const depositTransferEvent = events[1];
      const sharesMintEvent = events[2];
      const depositEvent = events[3];
      const stakeTransferEvent = events[4];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.add(assets));
      expect(sharesBefore).to.not.equal(sharesAfter);
      expect(sharesAfter).to.equal(sharesBefore.add(expectedShares));

      validateEvent(harvestEvent, 'Harvest(address,uint256)', {
        _caller: admin.address,
        _value: earned,
      });

      validateEvent(depositTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: unionPirex.address,
        amount: assets,
      });

      validateEvent(sharesMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: receiver,
        amount: expectedShares,
      });

      validateEvent(depositEvent, 'Deposit(address,address,uint256,uint256)', {
        caller: admin.address,
        owner: receiver,
        assets,
        shares: expectedShares,
      });

      validateEvent(stakeTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: unionPirexStrategy2.address,
        amount: assets,
      });
    });
  });

  describe('harvest', function () {
    before(async function () {
      const assets = toBN(1e18);

      await cvx.approve(pCvx.address, assets);

      // Get pxCVX and deposit as vault rewards
      await pCvx.deposit(assets, admin.address, false);
      await pxCvx.transfer(unionPirexStrategy2.address, assets);
      await unionPirexStrategy2.notifyRewardAmount(assets);
      await increaseBlockTimestamp(1209600);
    });

    it('Should harvest rewards', async function () {
      // We can reliably count on `earned`'s result since the reward distribution is finished
      const rewards = await unionPirexStrategy2.earned();
      const platform = await unionPirex.platform();
      const platformBalanceBefore = await pxCvx.balanceOf(platform);
      const totalAssetsBefore = await unionPirex.totalAssets();
      const events = await callAndReturnEvents(unionPirex.harvest, []);
      const getRewardEvent = events[0];
      const harvestEvent = events[2];
      const feeTransferEvent = events[3];
      const stakeTransferEvent = events[4];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const platformBalanceAfter = await pxCvx.balanceOf(platform);
      const feeAmount = platformBalanceAfter.sub(platformBalanceBefore);
      const stakedAmount = totalAssetsAfter.sub(totalAssetsBefore);

      // The staking contract's calculations works out to less than 1e18 (notified reward amount)
      // Should still be greater than 99.5% of the notified reward amount
      expect(rewards.gt(toBN(1e18).mul(995).div(1000))).to.equal(true);
      expect(platformBalanceAfter.gt(platformBalanceBefore)).to.equal(true);
      expect(totalAssetsAfter.gt(totalAssetsBefore)).to.equal(true);
      expect(feeAmount.add(stakedAmount)).to.equal(rewards);

      validateEvent(getRewardEvent, 'Transfer(address,address,uint256)', {
        from: unionPirexStrategy2.address,
        to: unionPirex.address,
        amount: rewards,
      });

      validateEvent(harvestEvent, 'Harvest(address,uint256)', {
        _caller: admin.address,
        _value: feeAmount.add(stakedAmount),
      });

      validateEvent(feeTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: platform,
        amount: feeAmount,
      });

      validateEvent(stakeTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: unionPirexStrategy2.address,
        amount: stakedAmount,
      });
    });
  });
});
