import Promise from 'bluebird';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  callAndReturnEvents,
  parseLog,
  validateEvent,
} from './helpers';
import {
  ConvexToken,
  PirexCvx,
  ERC1155Solmate,
  PxCvx,
} from '../typechain-types';
import { BigNumber } from 'ethers';

// Tests the emergency relock mechanism on CvxLockerV2 shutdown
describe('PirexCvx-Migration', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexCvx: PirexCvx;
  let cvx: ConvexToken;
  let zeroAddress: string;
  let oldUpxCvx: ERC1155Solmate;

  before(async function () {
    ({ admin, notAdmin, pxCvx, pirexCvx, cvx, zeroAddress } = this);

    const oldUpxCvxAddress = await pirexCvx.upxCvx();
    oldUpxCvx = await this.getUpxCvx(oldUpxCvxAddress);
  });

  describe('setUpxCvxDeprecated', function () {
    it('Should revert if not owner', async function () {
      await expect(
        pirexCvx.connect(notAdmin).setUpxCvxDeprecated(true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if not paused', async function () {
      const paused = await pirexCvx.paused();

      expect(paused).to.equal(false);
      await expect(pirexCvx.setUpxCvxDeprecated(true)).to.be.revertedWith(
        'Pausable: not paused'
      );
    });

    it('Should set upxCvx deprecation state by owner', async function () {
      await pirexCvx.setPauseState(true);

      const paused = await pirexCvx.paused();
      const state = true;
      const stateBefore = await pirexCvx.upxCvxDeprecated();
      const setEvent = await callAndReturnEvent(pirexCvx.setUpxCvxDeprecated, [
        state,
      ]);
      const stateAfter = await pirexCvx.upxCvxDeprecated();

      expect(paused).to.equal(true);
      expect(stateBefore).to.not.equal(stateAfter);
      expect(stateAfter).to.equal(state);

      validateEvent(setEvent, 'SetUpxCvxDeprecated(bool)', {
        state,
      });
    });
  });

  describe('redeemLegacy', function () {
    it('Should revert redemption with legacy upxCvx if not paused', async function () {
      await pirexCvx.setPauseState(false);

      const unlockTimes: any = [0];
      const assets: any = [0];

      await expect(
        pirexCvx.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('Pausable: not paused');
    });

    it('Should revert redemption with legacy upxCvx if not deprecated', async function () {
      await pirexCvx.setPauseState(true);

      await pirexCvx.setUpxCvxDeprecated(false);

      const unlockTimes: any = [0];
      const assets: any = [0];

      await expect(
        pirexCvx.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('RedeemClosed()');
    });

    it('Should revert if unlockTimes is an empty array', async function () {
      await pirexCvx.setUpxCvxDeprecated(true);

      const invalidUnlockTimes: any = [];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pirexCvx.redeemLegacy(invalidUnlockTimes, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if unlockTimes and assets have mismatched lengths', async function () {
      const unlockTimes = [0, 0];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pirexCvx.redeemLegacy(unlockTimes, assets, receiver)
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('should allow legacy upxCvx holders to immediately redeem for Cvx', async function () {
      // Parse transfer logs to fetch ids and balances of the upxCvx owned by the admin
      const unlockTimes: any = [];
      const assets: any = [];
      const receiver = admin.address;
      let totalAssets: BigNumber = BigNumber.from(0);
      const transferLogs = await oldUpxCvx.queryFilter(
        oldUpxCvx.filters.TransferSingle(
          null,
          zeroAddress,
          admin.address,
          null,
          null
        )
      );
      await Promise.each(transferLogs, async (log: any) => {
        const { id } = log.args;
        const balance = await oldUpxCvx.balanceOf(admin.address, id);

        unlockTimes.push(id);
        assets.push(balance);
        totalAssets = totalAssets.add(balance);
      });

      const cvxBalanceBefore = await cvx.balanceOf(receiver);
      const outstandingRedemptionsBefore =
        await pirexCvx.outstandingRedemptions();

      const events = await callAndReturnEvents(pirexCvx.redeemLegacy, [
        unlockTimes,
        assets,
        receiver,
      ]);

      const cvxBalanceAfter = await cvx.balanceOf(receiver);
      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(totalAssets));

      const outstandingRedemptionsAfter =
        await pirexCvx.outstandingRedemptions();
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.sub(totalAssets)
      );

      const redeemEvent = events[0];
      const cvxTransferEvent = parseLog(pxCvx, events[2]);

      validateEvent(redeemEvent, 'Redeem(uint256[],uint256[],address,bool)', {
        unlockTimes,
        assets,
        receiver,
        legacy: true,
      });
      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pirexCvx.address,
        to: receiver,
        amount: totalAssets,
      });

      // Assert the updated balances of the legacy upxCvx
      await Promise.each(transferLogs, async (log: any) => {
        const { id } = log.args;
        const balance = await oldUpxCvx.balanceOf(admin.address, id);

        expect(balance).to.equal(0);
      });
    });
  });
});
