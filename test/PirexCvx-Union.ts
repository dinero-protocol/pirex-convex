import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import {
  ConvexToken,
  PxCvx,
  PirexCvx,
  UnionPirexVault,
  UnionPirexStrategy,
  UnionPirexStaking,
} from '../typechain-types';
import { callAndReturnEvents, toBN, toBN2, validateEvent } from './helpers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Union', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let unionPirex: UnionPirexVault;
  let unionPirexStrategy: UnionPirexStrategy;
  let unionPirexStrategy2: UnionPirexStrategy;
  let unionPirexStaking: UnionPirexStaking;
  let cvx: ConvexToken;
  let zeroAddress: string;
  let contractEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      cvx,
      pxCvx,
      unionPirex,
      unionPirexStrategy,
      unionPirexStaking,
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
    await pCvx.approve(unionPirex.address, toBN2(1000e18).toFixed(0));

    unionPirexStrategy2 = await (
      await ethers.getContractFactory('UnionPirexStrategy')
    ).deploy(unionPirex.address, unionPirexStaking.address, pCvx.address);

    await unionPirexStrategy2.setApprovals();
  });

  describe('initial state', function () {
    it('Should have initialized state variables', async function () {
      const MAX_CALL_INCENTIVE = await unionPirex.MAX_CALL_INCENTIVE();
      const MAX_WITHDRAWAL_PENALTY = await unionPirex.MAX_WITHDRAWAL_PENALTY();
      const MAX_PLATFORM_FEE = await unionPirex.MAX_PLATFORM_FEE();
      const FEE_DENOMINATOR = await unionPirex.FEE_DENOMINATOR();
      const callIncentive = await unionPirex.callIncentive();
      const withdrawalPenalty = await unionPirex.withdrawalPenalty();
      const platformFee = await unionPirex.platformFee();

      expect(MAX_CALL_INCENTIVE).to.equal(250);
      expect(MAX_WITHDRAWAL_PENALTY).to.equal(500);
      expect(MAX_PLATFORM_FEE).to.equal(2000);
      expect(FEE_DENOMINATOR).to.equal(10000);
      expect(callIncentive).to.equal(100);
      expect(withdrawalPenalty).to.equal(300);
      expect(platformFee).to.equal(500);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const pirexCvx = await unionPirex.pirexCvx();
      const strategy = await unionPirex.strategy();
      const asset = await unionPirex.asset();
      const name = await unionPirex.name();
      const symbol = await unionPirex.symbol();

      expect(pirexCvx).to.equal(pCvx.address);
      expect(strategy).to.equal(unionPirexStrategy.address);
      expect(asset).to.equal(pCvx.address);
      expect(name).to.equal('Union Pirex');
      expect(symbol).to.equal('uCVX');
    });
  });

  describe('setStrategy', function () {
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
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set a new strategy', async function () {
      const getStrategyAllowance = async (strategy: string) =>
        await pCvx.allowance(unionPirex.address, strategy);
      const oldStrategy = unionPirexStrategy.address;
      const strategy = unionPirexStrategy2.address;
      const oldStrategyBalanceBefore =
        await unionPirexStrategy.totalUnderlying();
      const newStrategyBalanceBefore =
        await unionPirexStrategy2.totalUnderlying();
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
      const oldStrategyWithdrawEvent2 = events[4];
      const newStrategyStakeEvent = events[5];
      const newStrategyStakeEvent2 = events[6];
      const strategySetEvent = events[events.length - 1];
      const oldStrategyBalanceAfter =
        await unionPirexStrategy.totalUnderlying();
      const newStrategyBalanceAfter =
        await unionPirexStrategy2.totalUnderlying();
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
          from: unionPirexStaking.address,
          to: oldStrategy,
          amount: oldStrategyBalanceBefore,
        }
      );
      validateEvent(
        oldStrategyWithdrawEvent2,
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
      validateEvent(
        newStrategyStakeEvent2,
        'Transfer(address,address,uint256)',
        {
          from: strategy,
          to: unionPirexStaking.address,
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

    it('Should deposit pCVX', async function () {
      const assets = (await pCvx.balanceOf(admin.address)).div(10);
      const receiver = admin.address;
      const totalAssetsBefore = await unionPirex.totalAssets();
      const sharesBefore = await unionPirex.balanceOf(receiver);
      const expectedShares = await unionPirex.previewDeposit(assets);
      const events = await callAndReturnEvents(unionPirex.deposit, [
        assets,
        receiver,
      ]);
      const depositTransferEvent = events[0];
      const sharesMintEvent = events[1];
      const depositEvent = events[2];
      const stakeTransferEvent = events[3];
      const totalAssetsAfter = await unionPirex.totalAssets();
      const sharesAfter = await unionPirex.balanceOf(receiver);

      expect(totalAssetsBefore).to.not.equal(totalAssetsAfter);
      expect(totalAssetsAfter).to.equal(totalAssetsBefore.add(assets));
      expect(sharesBefore).to.not.equal(sharesAfter);
      expect(sharesAfter).to.equal(sharesBefore.add(expectedShares));
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
});
