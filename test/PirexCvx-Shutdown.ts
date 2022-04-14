import Promise from 'bluebird';
import { ethers } from 'hardhat';
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
  CvxLockerV2,
  PirexCvx,
  ERC1155Solmate,
  DelegateRegistry,
  PxCvx,
  PirexFees,
  MultiMerkleStash,
} from '../typechain-types';
import { BigNumber } from 'ethers';

// Tests the emergency relock mechanism on CvxLockerV2 shutdown
describe('PirexCvx-Shutdown', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexFees: PirexFees;
  let pCvx: PirexCvx;
  let pCvxNew: PirexCvx;
  let cvx: ConvexToken;
  let cvxLocker: CvxLockerV2;
  let cvxLockerNew: CvxLockerV2;
  let cvxDelegateRegistry: DelegateRegistry;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let zeroAddress: string;
  let oldUpCvx: ERC1155Solmate;

  before(async function () {
    ({
      admin,
      notAdmin,
      pxCvx,
      pCvx,
      cvx,
      cvxLocker,
      cvxLockerNew,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      zeroAddress,
      pirexFees,
    } = this);

    const oldUpCvxAddress = await pCvx.upCvx();
    oldUpCvx = await this.getUpCvx(oldUpCvxAddress);
  });

  describe('emergency', function () {
    before(async function () {
      await pCvx.setPauseState(true);
    });

    it('Should revert if not called by owner', async function () {
      await expect(pCvx.connect(notAdmin).pausedRelock()).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );

      await expect(pCvx.connect(notAdmin).unlock()).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );

      await expect(
        pCvx.connect(notAdmin).setPirexCvxMigration(zeroAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');

      await expect(
        pCvx.connect(notAdmin).emergencyMigrateTokens([zeroAddress])
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if not paused', async function () {
      await pCvx.setPauseState(false);

      await expect(pCvx.pausedRelock()).to.be.revertedWith(
        'Pausable: not paused'
      );
      await expect(pCvx.unlock()).to.be.revertedWith('Pausable: not paused');
      await expect(pCvx.setPirexCvxMigration(zeroAddress)).to.be.revertedWith(
        'Pausable: not paused'
      );
      await expect(
        pCvx.emergencyMigrateTokens([zeroAddress])
      ).to.be.revertedWith('Pausable: not paused');
    });

    it('Should revert redemption with legacy upCvx if disabled', async function () {
      const unlockTimes = [0];
      const assets = [0];

      await expect(
        pCvx.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('LegacyDisabled()');
    });

    it('Should perform emergency measures after the shutdown in CvxLockerV2', async function () {
      await pCvx.setPauseState(true);

      // Simulate shutdown in the old/current locker
      await cvxLocker.shutdown();

      // Withdraw all forced-unlocked CVX
      await pCvx.unlock();

      const cvxBalance = await cvx.balanceOf(pCvx.address);
      const outstandingRedemptions = await pCvx.outstandingRedemptions();

      // Deploy a new PirexCvx contract
      // Redeploy upCvx and set it to the new PirexCvx contract
      const upCvxNew: ERC1155Solmate = await (
        await ethers.getContractFactory('ERC1155Solmate')
      ).deploy();
      const spCvxAddress = await pCvx.spCvx();
      const rpCvxAddress = await pCvx.rpCvx();
      const vpCvxAddress = await pCvx.vpCvx();
      pCvxNew = await (
        await ethers.getContractFactory('PirexCvx')
      ).deploy(
        cvx.address,
        cvxLockerNew.address,
        cvxDelegateRegistry.address,
        pxCvx.address,
        upCvxNew.address,
        spCvxAddress,
        vpCvxAddress,
        rpCvxAddress,
        pirexFees.address,
        votiumMultiMerkleStash.address,
        oldUpCvx.address,
        outstandingRedemptions // Required to keep track of old upCvx claims
      );

      const upCvxAfter = await pCvxNew.upCvx();
      const upCvxLegacy = await pCvxNew.upCvxLegacy();
      const outstandingRedemptionsNew = await pCvx.outstandingRedemptions();
      expect(upCvxAfter).to.equal(upCvxNew.address);
      expect(upCvxLegacy).to.equal(oldUpCvx.address);
      expect(outstandingRedemptionsNew).to.equal(outstandingRedemptions);

      const migrationAddress = pCvxNew.address;

      // Set migration and migrate tokens over
      const setEvent = await callAndReturnEvent(pCvx.setPirexCvxMigration, [
        migrationAddress,
      ]);
      validateEvent(setEvent, 'SetPirexCvxMigration(address)', {
        migrationAddress,
      });

      const pirexCvxMigration = await pCvx.pirexCvxMigration();
      expect(pirexCvxMigration).to.equal(migrationAddress);

      const tokens = [cvx.address];
      const amounts = [cvxBalance];
      const pCvxNewBalanceBefore = await cvx.balanceOf(migrationAddress);

      const migrateEvent = await callAndReturnEvent(
        pCvx.emergencyMigrateTokens,
        [tokens]
      );
      validateEvent(
        migrateEvent,
        'MigrateTokens(address,address[],uint256[])',
        {
          migrationAddress,
          tokens,
          amounts,
        }
      );

      const pCvxNewBalanceAfter = await cvx.balanceOf(migrationAddress);

      expect(pCvxNewBalanceAfter).to.equal(
        pCvxNewBalanceBefore.add(cvxBalance)
      );

      // Attempt to relock with the new locker
      await pCvxNew.pausedRelock();

      // Confirm that the correct amount of Cvx are relocked
      const lockedBalanceAfter = await cvxLockerNew.lockedBalanceOf(
        migrationAddress
      );
      expect(lockedBalanceAfter).to.equal(
        cvxBalance.sub(outstandingRedemptionsNew)
      );
    });
  });

  describe('redeemLegacy', function () {
    it('Should revert redemption with legacy upCvx if paused', async function () {
      const unlockTimes: any = [0];
      const assets: any = [0];

      await expect(
        pCvxNew.redeemLegacy(unlockTimes, assets, admin.address)
      ).to.be.revertedWith('Pausable: paused');
    });

    it('Should revert if unlockTimes is an empty array', async function () {
      // Unpause before proceeding
      await pCvxNew.setPauseState(false);

      const invalidUnlockTimes: any = [];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pCvxNew.redeem(invalidUnlockTimes, assets, receiver)
      ).to.be.revertedWith('EmptyArray()');
    });

    it('Should revert if unlockTimes and assets have mismatched lengths', async function () {
      const unlockTimes = [0, 0];
      const assets = [0];
      const receiver = admin.address;

      await expect(
        pCvxNew.redeem(unlockTimes, assets, receiver)
      ).to.be.revertedWith('MismatchedArrayLengths()');
    });

    it('should allow legacy upCvx holders to immediately redeem for Cvx', async function () {
      // Grant the minter role to allow burning
      await oldUpCvx.grantMinterRole(pCvxNew.address);

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
      const outstandingRedemptionsBefore =
        await pCvxNew.outstandingRedemptions();

      const events = await callAndReturnEvents(pCvxNew.redeemLegacy, [
        unlockTimes,
        assets,
        receiver,
      ]);

      const cvxBalanceAfter = await cvx.balanceOf(receiver);
      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(totalAssets));

      const outstandingRedemptionsAfter =
        await pCvxNew.outstandingRedemptions();
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
        from: pCvxNew.address,
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
