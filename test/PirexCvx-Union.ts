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
import { callAndReturnEvents, toBN, toBN2, validateEvent } from './helpers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Union', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
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
    await pCvx.approve(unionPirex.address, toBN2(1000e18).toFixed(0));

    unionPirexStrategy2 = await (
      await ethers.getContractFactory('UnionPirexStrategy')
    ).deploy(unionPirex.address, pCvx.address, admin.address);
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
      ).to.be.revertedWith(
        `AccessControl: account ${
          notAdmin.address.toLowerCase()
        } is missing role ${await unionPirex.DEFAULT_ADMIN_ROLE()}`
      );
    });

    it('Should set a new strategy', async function () {
      const getStrategyAllowance = async (strategy: string) =>
        await pCvx.allowance(unionPirex.address, strategy);
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
