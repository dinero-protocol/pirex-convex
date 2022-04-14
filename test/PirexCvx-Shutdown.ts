import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { callAndReturnEvent, validateEvent } from './helpers';
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

// Tests the emergency relock mechanism on CvxLockerV2 shutdown
describe('PirexCvx-Shutdown', function () {
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexFees: PirexFees;
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let cvxLocker: CvxLockerV2;
  let cvxLockerNew: CvxLockerV2;
  let cvxDelegateRegistry: DelegateRegistry;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let zeroAddress: string;

  before(async function () {
    ({
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
  });

  describe('emergency', function () {
    before(async function () {
      await pCvx.setPauseState(true);
    });

    it('Should revert if not called by owner', async function () {
      await expect(pCvx.connect(notAdmin).relock()).to.be.revertedWith(
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

      await expect(pCvx.relock()).to.be.revertedWith('Pausable: not paused');
      await expect(pCvx.unlock()).to.be.revertedWith('Pausable: not paused');
      await expect(pCvx.setPirexCvxMigration(zeroAddress)).to.be.revertedWith(
        'Pausable: not paused'
      );
      await expect(
        pCvx.emergencyMigrateTokens([zeroAddress])
      ).to.be.revertedWith('Pausable: not paused');
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
      const pCvxNew: PirexCvx = await (
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
        outstandingRedemptions, // Required to keep track of old upCvx claims
      );

      const upCvxAfter = await pCvxNew.upCvx();
      const outstandingRedemptionsNew = await pCvx.outstandingRedemptions();
      expect(upCvxAfter).to.be.equal(upCvxNew.address);
      expect(outstandingRedemptionsNew).to.be.equal(outstandingRedemptions);

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
      await pCvxNew.relock();

      // Confirm that the correct amount of Cvx are relocked
      const lockedBalanceAfter = await cvxLockerNew.lockedBalanceOf(
        migrationAddress
      );
      expect(lockedBalanceAfter).to.equal(cvxBalance.sub(outstandingRedemptionsNew));
    });
  });
});
