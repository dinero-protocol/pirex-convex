import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import {
  ConvexToken,
  PxCvx,
  PirexCvx,
  UnionPirexVault,
  UnionPirexStrategy,
  Crv,
  MultiMerkleStash,
} from '../typechain-types';
import {
  callAndReturnEvents,
  increaseBlockTimestamp,
  toBN,
  toBN2,
  validateEvent,
  parseLog,
} from './helpers';
import { BalanceTree } from '../lib/merkle';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-UnionPirex*', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let pxCvx: PxCvx;
  let unionPirex: UnionPirexVault;
  let unionPirexStrategy: UnionPirexStrategy;
  let unionPirexStrategy2: UnionPirexStrategy;
  let cvx: ConvexToken;
  let crv: Crv;
  let zeroAddress: string;
  let contractEnum: any;
  let votiumMultiMerkleStash: MultiMerkleStash;

  const fourteenDays = 1209600;

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
      crv,
      votiumMultiMerkleStash,
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

  describe('UnionPirexVault: initial state', function () {
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

  describe('UnionPirexStrategy: initial state', function () {
    it('Should have initialized state variables', async function () {
      const rewardsDuration = await unionPirexStrategy.rewardsDuration();

      expect(rewardsDuration).to.equal(fourteenDays);
    });
  });

  describe('UnionPirexVault: constructor', function () {
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

  describe('UnionPirexStrategy: constructor', function () {
    it('Should set up contract state', async function () {
      const pirexCvx = await unionPirexStrategy.pirexCvx();
      const vault = await unionPirexStrategy.vault();
      const token = await unionPirexStrategy.token();
      const distributor = await unionPirexStrategy.distributor();
      const pirexCvx2 = await unionPirexStrategy2.pirexCvx();
      const vault2 = await unionPirexStrategy2.vault();
      const token2 = await unionPirexStrategy2.token();
      const distributor2 = await unionPirexStrategy2.distributor();

      expect(pirexCvx).to.equal(pCvx.address);
      expect(vault).to.equal(unionPirex.address);
      expect(token).to.equal(pxCvx.address);
      expect(distributor).to.equal(admin.address);
      expect(pirexCvx2).to.equal(pirexCvx);
      expect(vault2).to.equal(vault);
      expect(token2).to.equal(token);
      expect(distributor2).to.equal(distributor);
    });
  });

  describe('UnionPirexVault: setWithdrawalPenalty', function () {
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
      const penalty = toBN(100);
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

  describe('UnionPirexVault: setPlatform', function () {
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

  describe('UnionPirexVault: setStrategy', function () {
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
      const oldStrategyTransferEvent = events[2];
      const oldStrategyWithdrawEvent = parseLog(unionPirexStrategy, events[3]);
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
        oldStrategyTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: oldStrategy,
          to: unionPirex.address,
          amount: oldStrategyBalanceBefore,
        }
      );

      validateEvent(oldStrategyWithdrawEvent, 'Withdrawn(uint256)', {
        amount: oldStrategyBalanceBefore,
      });

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

  describe('UnionPirexStrategy: notifyRewardAmount', function () {
    it('Should revert if not called by distributor', async function () {
      const distributor = await unionPirexStrategy2.distributor();

      expect(notAdmin.address).to.not.equal(distributor);
      await expect(
        unionPirexStrategy2.connect(notAdmin).notifyRewardAmount()
      ).to.be.revertedWith('Distributor only');
    });

    it('Should set the reward distribution parameters', async function () {
      const reward = toBN(1e18);
      const rewardRateBefore = await unionPirexStrategy2.rewardRate();
      const lastUpdateTimeBefore = await unionPirexStrategy2.lastUpdateTime();
      const periodFinishBefore = await unionPirexStrategy2.periodFinish();

      await cvx.approve(pCvx.address, reward);

      // Get pxCVX and deposit as vault reward
      await pCvx.deposit(reward, admin.address, false);
      await pxCvx.transfer(unionPirexStrategy2.address, reward);

      const events = await callAndReturnEvents(
        unionPirexStrategy2.notifyRewardAmount,
        []
      );
      const rewardAddedEvent = events[0];
      const rewardRateAfter = await unionPirexStrategy2.rewardRate();
      const lastUpdateTimeAfter = await unionPirexStrategy2.lastUpdateTime();
      const periodFinishAfter = await unionPirexStrategy2.periodFinish();

      expect(rewardRateAfter).to.not.equal(rewardRateBefore);
      expect(lastUpdateTimeAfter).to.not.equal(lastUpdateTimeBefore);
      expect(periodFinishAfter).to.not.equal(periodFinishBefore);
      expect(rewardRateAfter).to.equal(reward.div(fourteenDays));

      validateEvent(rewardAddedEvent, 'RewardAdded(uint256)', {
        reward,
      });
    });
  });

  describe('UnionPirexStrategy: setDistributor', function () {
    it('Should revert if not called by owner', async function () {
      const owner = await unionPirexStrategy2.owner();

      expect(notAdmin.address).to.not.equal(owner);
      await expect(
        unionPirexStrategy2.connect(notAdmin).setDistributor(notAdmin.address)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should should set a new distributor', async function () {
      const distributorBefore = await unionPirexStrategy2.distributor();
      const distributor = notAdmin.address;

      await unionPirexStrategy2.setDistributor(distributor);

      const distributorAfter = await unionPirexStrategy2.distributor();

      // Set back to original for testing convenience
      await unionPirexStrategy2.setDistributor(admin.address);

      expect(distributorBefore).to.not.equal(distributorAfter);
      expect(distributorBefore).to.equal(admin.address);
      expect(distributorAfter).to.equal(distributor);
    });
  });

  describe('UnionPirexVault: harvest', function () {
    before(async function () {
      await increaseBlockTimestamp(fourteenDays);
    });

    it('Should harvest rewards', async function () {
      // We can reliably count on `earned`'s result since the reward distribution is finished
      const rewards = await unionPirexStrategy2.earned();
      const platform = await unionPirex.platform();
      const platformBalanceBefore = await pxCvx.balanceOf(platform);
      const totalAssetsBefore = await unionPirex.totalAssets();
      const totalSupplyBefore = await unionPirex.totalSupply();
      const events = await callAndReturnEvents(unionPirex.harvest, []);
      const getRewardEvent = events[0];
      const rewardPaidEvent = parseLog(unionPirexStrategy2, events[1]);
      const harvestEvent = events[2];
      const feeTransferEvent = events[3];
      const stakeTransferEvent = events[4];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const totalSupplyAfter = await unionPirex.totalSupply();
      const platformBalanceAfter = await pxCvx.balanceOf(platform);
      const feeAmount = platformBalanceAfter.sub(platformBalanceBefore);
      const stakedAmount = totalAssetsAfter.sub(totalAssetsBefore);

      // The staking contract's calculations works out to less than 1e18 (notified reward amount)
      // Should still be greater than 99.5% of the notified reward amount
      expect(rewards.gt(toBN(1e18).mul(995).div(1000))).to.equal(true);
      expect(platformBalanceAfter.gt(platformBalanceBefore)).to.equal(true);
      expect(totalAssetsAfter.gt(totalAssetsBefore)).to.equal(true);
      expect(feeAmount.add(stakedAmount)).to.equal(rewards);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore);

      validateEvent(getRewardEvent, 'Transfer(address,address,uint256)', {
        from: unionPirexStrategy2.address,
        to: unionPirex.address,
        amount: rewards,
      });

      validateEvent(rewardPaidEvent, 'RewardPaid(uint256)', {
        reward: rewards,
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

  describe('UnionPirexVault: deposit', function () {
    it('Should revert if assets is zero', async function () {
      const invalidAssets = 0;
      const receiver = admin.address;

      await expect(
        unionPirex.deposit(invalidAssets, receiver)
      ).to.be.revertedWith('ZERO_SHARES');
    });

    it('Should revert if receiver is zero address', async function () {
      const assets = 1;
      const invalidReceiver = zeroAddress;

      await expect(
        unionPirex.deposit(assets, invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should deposit pxCVX', async function () {
      const assets = (await pxCvx.balanceOf(admin.address)).div(10);
      const receiver = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const totalSupplyBefore = await unionPirex.totalSupply();
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
      const totalSupplyAfter = await unionPirex.totalSupply();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.add(assets));
      expect(totalSupplyBefore).to.not.equal(totalSupplyAfter);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.add(expectedShares));
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

  describe('UnionPirexVault: mint', function () {
    it('Should revert if assets is zero', async function () {
      const invalidShares = 0;
      const receiver = admin.address;

      await expect(unionPirex.mint(invalidShares, receiver)).to.be.revertedWith(
        'Cannot stake 0'
      );
    });

    it('Should revert if receiver is zero address', async function () {
      const shares = 1;
      const invalidReceiver = zeroAddress;

      await expect(unionPirex.mint(shares, invalidReceiver)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should mint uCVX', async function () {
      const shares = toBN(1e18);
      const receiver = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const totalSupplyBefore = await unionPirex.totalSupply();
      const sharesBefore = await unionPirex.balanceOf(receiver);
      const expectedAssets = await unionPirex.previewMint(shares);
      const earned = await unionPirexStrategy2.earned();
      const events = await callAndReturnEvents(unionPirex.mint, [
        shares,
        receiver,
      ]);
      const harvestEvent = events[0];
      const depositTransferEvent = events[1];
      const sharesMintEvent = events[2];
      const depositEvent = events[3];
      const stakeTransferEvent = events[4];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const totalSupplyAfter = await unionPirex.totalSupply();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.add(expectedAssets));
      expect(totalSupplyBefore).to.not.equal(totalSupplyAfter);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.add(shares));
      expect(sharesBefore).to.not.equal(sharesAfter);
      expect(sharesAfter).to.equal(sharesBefore.add(shares));

      validateEvent(harvestEvent, 'Harvest(address,uint256)', {
        _caller: admin.address,
        _value: earned,
      });

      validateEvent(depositTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: unionPirex.address,
        amount: expectedAssets,
      });

      validateEvent(sharesMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: receiver,
        amount: shares,
      });

      validateEvent(depositEvent, 'Deposit(address,address,uint256,uint256)', {
        caller: admin.address,
        owner: receiver,
        assets: expectedAssets,
        shares,
      });

      validateEvent(stakeTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: unionPirexStrategy2.address,
        amount: expectedAssets,
      });
    });
  });

  describe('UnionPirexVault: withdraw', function () {
    it('Should revert if assets is zero', async function () {
      const invalidAssets = 0;
      const receiver = admin.address;
      const owner = admin.address;

      await expect(
        unionPirex.withdraw(invalidAssets, receiver, owner)
      ).to.be.revertedWith('Cannot withdraw 0');
    });

    it('Should revert if receiver is zero address', async function () {
      const assets = 1;
      const invalidReceiver = zeroAddress;
      const owner = admin.address;

      await expect(
        unionPirex.withdraw(assets, invalidReceiver, owner)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if owner is zero address', async function () {
      const assets = 1;
      const receiver = admin.address;
      const invalidOwner = zeroAddress;

      await expect(
        unionPirex.withdraw(assets, receiver, invalidOwner)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should withdraw pxCVX', async function () {
      const assets = toBN(1e18);
      const receiver = admin.address;
      const owner = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const totalSupplyBefore = await unionPirex.totalSupply();
      const sharesBefore = await unionPirex.balanceOf(receiver);
      const expectedShares = await unionPirex.previewWithdraw(assets);
      const earned = await unionPirexStrategy2.earned();
      const events = await callAndReturnEvents(unionPirex.withdraw, [
        assets,
        receiver,
        owner,
      ]);
      const harvestEvent = events[0];
      const withdrawTransferEvent = events[1];
      const withdrawnEvent = parseLog(unionPirexStrategy2, events[2]);
      const sharesBurnEvent = events[3];
      const withdrawEvent = events[4];
      const pxCvxTransferEvent = events[5];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const totalSupplyAfter = await unionPirex.totalSupply();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.sub(assets));
      expect(totalSupplyBefore).to.not.equal(totalSupplyAfter);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.sub(expectedShares));
      expect(sharesBefore).to.not.equal(sharesAfter);
      expect(sharesAfter).to.equal(sharesBefore.sub(expectedShares));

      validateEvent(harvestEvent, 'Harvest(address,uint256)', {
        _caller: admin.address,
        _value: earned,
      });

      validateEvent(
        withdrawTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: unionPirexStrategy2.address,
          to: unionPirex.address,
          amount: assets,
        }
      );

      validateEvent(withdrawnEvent, 'Withdrawn(uint256)', {
        amount: assets,
      });

      validateEvent(sharesBurnEvent, 'Transfer(address,address,uint256)', {
        from: owner,
        to: zeroAddress,
        amount: expectedShares,
      });

      validateEvent(
        withdrawEvent,
        'Withdraw(address,address,address,uint256,uint256)',
        {
          caller: admin.address,
          receiver,
          owner,
          assets,
          shares: expectedShares,
        }
      );

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: receiver,
        amount: assets,
      });
    });
  });

  describe('UnionPirexVault: redeem', function () {
    it('Should revert if assets is zero', async function () {
      const invalidShares = 0;
      const receiver = admin.address;
      const owner = admin.address;

      await expect(
        unionPirex.redeem(invalidShares, receiver, owner)
      ).to.be.revertedWith('ZERO_ASSETS');
    });

    it('Should revert if receiver is zero address', async function () {
      const shares = 1;
      const invalidReceiver = zeroAddress;
      const owner = admin.address;

      await expect(
        unionPirex.redeem(shares, invalidReceiver, owner)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if owner is zero address', async function () {
      const shares = 1;
      const receiver = admin.address;
      const invalidOwner = zeroAddress;

      await expect(
        unionPirex.redeem(shares, receiver, invalidOwner)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should redeem pxCVX', async function () {
      const shares = await unionPirex.balanceOf(admin.address);
      const receiver = admin.address;
      const owner = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const totalSupplyBefore = await unionPirex.totalSupply();
      const sharesBefore = await unionPirex.balanceOf(receiver);
      const expectedAssets = await unionPirex.previewRedeem(shares);
      const earned = await unionPirexStrategy2.earned();
      const events = await callAndReturnEvents(unionPirex.redeem, [
        shares,
        receiver,
        owner,
      ]);
      const harvestEvent = events[0];
      const withdrawTransferEvent = events[1];
      const strategyWithdrawEvent = parseLog(unionPirexStrategy2, events[2]);
      const sharesBurnEvent = events[3];
      const withdrawEvent = events[4];
      const pxCvxTransferEvent = events[5];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const totalSupplyAfter = await unionPirex.totalSupply();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.sub(expectedAssets));
      expect(totalSupplyBefore).to.not.equal(totalSupplyAfter);
      expect(totalSupplyAfter).to.equal(totalSupplyBefore.sub(shares));
      expect(sharesBefore).to.not.equal(sharesAfter);
      expect(sharesAfter).to.equal(sharesBefore.sub(shares)).to.equal(0);
      expect(sharesAfter).to.equal(totalSupplyAfter);

      validateEvent(harvestEvent, 'Harvest(address,uint256)', {
        _caller: admin.address,
        _value: earned,
      });

      validateEvent(
        withdrawTransferEvent,
        'Transfer(address,address,uint256)',
        {
          from: unionPirexStrategy2.address,
          to: unionPirex.address,
          amount: expectedAssets,
        }
      );

      validateEvent(sharesBurnEvent, 'Transfer(address,address,uint256)', {
        from: owner,
        to: zeroAddress,
        amount: shares,
      });

      validateEvent(strategyWithdrawEvent, 'Withdrawn(uint256)', {
        amount: expectedAssets,
      });

      validateEvent(
        withdrawEvent,
        'Withdraw(address,address,address,uint256,uint256)',
        {
          caller: admin.address,
          receiver,
          owner,
          assets: expectedAssets,
          shares,
        }
      );

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: unionPirex.address,
        to: receiver,
        amount: expectedAssets,
      });
    });
  });

  describe('UnionPirexStrategy: redeemRewards', function () {
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

    it('Should redeem rewards', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId, snapshotRewards } = await pxCvx.getEpoch(
        currentEpoch
      );
      const distributor = await unionPirexStrategy2.distributor();
      const cvxBalanceBefore = await cvx.balanceOf(distributor);
      const crvBalanceBefore = await crv.balanceOf(distributor);
      const rewardIndexes = [0, 1];
      const pxCvxBalanceAtSnapshot = await pxCvx.balanceOfAt(
        unionPirexStrategy2.address,
        snapshotId
      );
      const pxCvxSupplyAtSnapshot = await pxCvx.totalSupplyAt(snapshotId);
      const cvxSnapshotRewards = snapshotRewards[0];
      const crvSnapshotRewards = snapshotRewards[1];
      const expectedCvxRewards = cvxSnapshotRewards
        .mul(pxCvxBalanceAtSnapshot)
        .div(pxCvxSupplyAtSnapshot);
      const expectedCrvRewards = crvSnapshotRewards
        .mul(pxCvxBalanceAtSnapshot)
        .div(pxCvxSupplyAtSnapshot);
      const events = await callAndReturnEvents(
        unionPirexStrategy2.redeemRewards,
        [currentEpoch, rewardIndexes]
      );
      const redeemEvent = parseLog(pCvx, events[0]);
      const cvxTransferEvent = parseLog(cvx, events[1]);
      const crvTransferEvent = parseLog(crv, events[2]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(expectedCrvRewards)
      );

      validateEvent(
        redeemEvent,
        'RedeemSnapshotRewards(uint256,uint256[],address,uint256,uint256)',
        {
          epoch: currentEpoch,
          rewardIndexes: rewardIndexes.map((i) => toBN(i)),
          receiver: distributor,
          snapshotBalance: pxCvxBalanceAtSnapshot,
          snapshotSupply: pxCvxSupplyAtSnapshot,
        }
      );

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: distributor,
        value: expectedCvxRewards,
      });

      validateEvent(crvTransferEvent, 'Transfer(address,address,uint256)', {
        from: pCvx.address,
        to: distributor,
        value: expectedCrvRewards,
      });
    });
  });

  describe('UnionPirexStrategy: totalSupply', function () {
    it('Should equal the result of the vault totalAssets', async function () {
      const totalSupply = await unionPirexStrategy2.totalSupply();
      const totalAssets = await unionPirex.totalAssets();

      expect(totalSupply).to.equal(totalAssets);
    });
  });

  describe('UnionPirexStrategy: stake', function () {
    it('Should revert if not called by vault', async function () {
      const vault = unionPirexStrategy2.vault();
      const amount = 1;

      expect(admin.address).to.not.equal(vault);
      await expect(
        unionPirexStrategy2.stake(amount)
      ).to.be.revertedWith('Vault only');
    });
  });

  describe('UnionPirexStrategy: withdraw', function () {
    it('Should revert if not called by vault', async function () {
      const vault = unionPirexStrategy2.vault();
      const amount = 1;

      expect(admin.address).to.not.equal(vault);
      await expect(
        unionPirexStrategy2.withdraw(amount)
      ).to.be.revertedWith('Vault only');
    });
  });
});
