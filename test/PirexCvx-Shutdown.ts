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
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let zeroAddress: string;
  let oldUpCvx: ERC1155Solmate;

  before(async function () {
    ({ admin, notAdmin, pxCvx, pCvx, cvx, zeroAddress } = this);

    const oldUpCvxAddress = await pCvx.upCvx();
    oldUpCvx = await this.getUpCvx(oldUpCvxAddress);
  });

  describe('setUpCvxDeprecated', function () {
    it('Should revert if not owner', async function () {
      await expect(
        pCvx.connect(notAdmin).setUpCvxDeprecated(true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if not paused', async function () {
      const paused = await pCvx.paused();

      expect(paused).to.equal(false);
      await expect(pCvx.setUpCvxDeprecated(true)).to.be.revertedWith(
        'Pausable: not paused'
      );
    });

    it('Should set upCvx deprecation state by owner', async function () {
      await pCvx.setPauseState(true);

      const paused = await pCvx.paused();
      const state = true;
      const stateBefore = await pCvx.upCvxDeprecated();
      const setEvent = await callAndReturnEvent(pCvx.setUpCvxDeprecated, [
        state,
      ]);
      const stateAfter = await pCvx.upCvxDeprecated();

      expect(paused).to.equal(true);
      expect(stateBefore).to.not.equal(stateAfter);
      expect(stateAfter).to.equal(state);

      validateEvent(setEvent, 'SetUpCvxDeprecated(bool)', {
        state,
      });
    });
  });

  describe('redeemLegacy', function () {
    it('Should revert redemption with legacy upCvx if not paused', async function () {
      await pCvx.setPauseState(false);

      const unlockTimes: any = [0];
      const assets: any = [0];

      await expect(
        pCvx.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('Pausable: not paused');
    });

    it('Should revert redemption with legacy upCvx if not deprecated', async function () {
      await pCvx.setPauseState(true);

      await pCvx.setUpCvxDeprecated(false);

      const unlockTimes: any = [0];
      const assets: any = [0];

      await expect(
        pCvx.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('RedeemClosed()');
    });

    it('Should revert if unlockTimes is an empty array', async function () {
      await pCvx.setUpCvxDeprecated(true);

      const invalidUnlockTimes: any = [];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pCvx.redeemLegacy(invalidUnlockTimes, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if unlockTimes and assets have mismatched lengths', async function () {
      const unlockTimes = [0, 0];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pCvx.redeemLegacy(unlockTimes, assets, receiver)
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('should allow legacy upCvx holders to immediately redeem for Cvx', async function () {
      // Parse transfer logs to fetch ids and balances of the upCvx owned by the admin
      const unlockTimes: any = [];
      const assets: any = [];
      const receiver = admin.address;
      let totalAssets: BigNumber = BigNumber.from(0);
      const transferLogs = await oldUpCvx.queryFilter(
        oldUpCvx.filters.TransferSingle(
          null,
          zeroAddress,
          admin.address,
          null,
          null
        )
      );
      await Promise.each(transferLogs, async (log: any) => {
        const { id } = log.args;
        const balance = await oldUpCvx.balanceOf(admin.address, id);

        unlockTimes.push(id);
        assets.push(balance);
        totalAssets = totalAssets.add(balance);
      });

      const cvxBalanceBefore = await cvx.balanceOf(receiver);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();

      const events = await callAndReturnEvents(pCvx.redeemLegacy, [
        unlockTimes,
        assets,
        receiver,
      ]);

      const cvxBalanceAfter = await cvx.balanceOf(receiver);
      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(totalAssets));

      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
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
        from: pCvx.address,
        to: receiver,
        amount: totalAssets,
      });

      // Assert the updated balances of the legacy upCvx
      await Promise.each(transferLogs, async (log: any) => {
        const { id } = log.args;
        const balance = await oldUpCvx.balanceOf(admin.address, id);

        expect(balance).to.equal(0);
      });
    });
  });
});
