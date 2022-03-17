import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { uniq } from 'lodash';
import { callAndReturnEvents, toBN } from './helpers';
import { FeePool } from '../typechain-types';

describe('FeePool', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let revenueLockers: SignerWithAddress;
  let contributors: SignerWithAddress;
  let feePool: FeePool;

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const feeRecipientEnum = {
    treasury: 0,
    revenueLockers: 1,
    contributors: 2,
  };

  before(async () => {
    [admin, notAdmin, treasury, revenueLockers, contributors] =
      await ethers.getSigners();
    feePool = await (
      await ethers.getContractFactory('FeePool')
    ).deploy(treasury.address, revenueLockers.address, contributors.address);
  });

  describe('initial state', () => {
    it('Should have predefined state variables', async () => {
      const PERCENT_DENOMINATOR = await feePool.PERCENT_DENOMINATOR();
      const treasuryPercent = await feePool.treasuryPercent();
      const revenueLockersPercent = await feePool.revenueLockersPercent();
      const contributorsPercent = await feePool.contributorsPercent();

      expect(PERCENT_DENOMINATOR).to.equal(100);
      expect(treasuryPercent).to.equal(25);
      expect(revenueLockersPercent).to.equal(50);
      expect(contributorsPercent).to.equal(25);
    });
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const _treasury = await feePool.treasury();
      const _revenueLockers = await feePool.revenueLockers();
      const _contributors = await feePool.contributors();
      const adminRole = await feePool.DEFAULT_ADMIN_ROLE();
      const treasuryRole = await feePool.TREASURY_ROLE();
      const revenueLockersRole = await feePool.REVENUE_LOCKERS_ROLE();
      const contributorsRole = await feePool.CONTRIBUTORS_ROLE();
      const adminHasRole = await feePool.hasRole(adminRole, admin.address);
      const treasuryHasRole = await feePool.hasRole(treasuryRole, _treasury);
      const revenueLockersHasRole = await feePool.hasRole(
        revenueLockersRole,
        _revenueLockers
      );
      const contributorsHasRole = await feePool.hasRole(
        contributorsRole,
        _contributors
      );
      const notAdminHasAdminRole = await feePool.hasRole(
        adminRole,
        notAdmin.address
      );
      const notAdminHasTreasuryRole = await feePool.hasRole(
        treasuryRole,
        notAdmin.address
      );
      const notAdminHasRevenueLockersRole = await feePool.hasRole(
        revenueLockersRole,
        notAdmin.address
      );
      const notAdminHasContributorsRole = await feePool.hasRole(
        contributorsRole,
        notAdmin.address
      );
      const roles = [
        adminRole,
        treasuryRole,
        revenueLockersRole,
        contributorsRole,
      ];

      expect(_treasury).to.equal(treasury.address);
      expect(_revenueLockers).to.equal(revenueLockers.address);
      expect(_contributors).to.equal(contributors.address);
      expect(adminHasRole).to.equal(true);
      expect(treasuryHasRole).to.equal(true);
      expect(revenueLockersHasRole).to.equal(true);
      expect(contributorsHasRole).to.equal(true);
      expect(notAdminHasAdminRole).to.equal(false);
      expect(notAdminHasTreasuryRole).to.equal(false);
      expect(notAdminHasRevenueLockersRole).to.equal(false);
      expect(notAdminHasContributorsRole).to.equal(false);
      expect(uniq(roles).length).to.equal(roles.length);
    });
  });

  describe('setFeeRecipient', () => {
    it('Should revert if f enum is out of range', async () => {
      const invalidF = feeRecipientEnum.contributors + 1;

      await expect(
        feePool.setFeeRecipient(invalidF, admin.address)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if recipient is zero address', async () => {
      const f = feeRecipientEnum.treasury;
      const invalidRecipient = zeroAddress;

      await expect(
        feePool.setFeeRecipient(f, invalidRecipient)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by admin', async () => {
      const f = feeRecipientEnum.treasury;
      const recipient = admin.address;
      const adminRole = await feePool.DEFAULT_ADMIN_ROLE();

      await expect(
        feePool.connect(notAdmin).setFeeRecipient(f, recipient)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should set treasury', async () => {
      const newTreasury = notAdmin.address;
      const treasuryRole = await feePool.TREASURY_ROLE();
      const treasuryBefore = await feePool.treasury();
      const treasuryHasRoleBefore = await feePool.hasRole(
        treasuryRole,
        treasury.address
      );
      const newTreasuryHasRoleBefore = await feePool.hasRole(
        treasuryRole,
        newTreasury
      );
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.treasury,
        newTreasury,
      ]);
      const treasuryAfter = await feePool.treasury();
      const treasuryHasRoleAfter = await feePool.hasRole(
        treasuryRole,
        treasury.address
      );
      const newTreasuryHasRoleAfter = await feePool.hasRole(
        treasuryRole,
        newTreasury
      );

      // Revert change to appropriate value for future tests
      await feePool.setFeeRecipient(feeRecipientEnum.treasury, treasuryBefore);

      expect(treasuryBefore).to.equal(treasury.address);
      expect(treasuryBefore).to.not.equal(treasuryAfter);
      expect(treasuryAfter).to.equal(notAdmin.address);
      expect(treasuryHasRoleBefore).to.equal(true);
      expect(treasuryHasRoleAfter).to.equal(false);
      expect(newTreasuryHasRoleBefore).to.equal(false);
      expect(newTreasuryHasRoleAfter).to.equal(true);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.treasury);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);

      // Test change reversion
      expect(treasuryBefore).to.equal(await feePool.treasury());
      expect(await feePool.hasRole(treasuryRole, treasuryBefore)).to.equal(
        true
      );
    });

    it('Should set revenueLockers', async () => {
      const newRevenueLockers = notAdmin.address;
      const revenueLockersRole = await feePool.REVENUE_LOCKERS_ROLE();
      const revenueLockersBefore = await feePool.revenueLockers();
      const revenueLockersHasRoleBefore = await feePool.hasRole(
        revenueLockersRole,
        revenueLockers.address
      );
      const newRevenueLockersHasRoleBefore = await feePool.hasRole(
        revenueLockersRole,
        newRevenueLockers
      );
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.revenueLockers,
        newRevenueLockers,
      ]);
      const revenueLockersAfter = await feePool.revenueLockers();
      const revenueLockersHasRoleAfter = await feePool.hasRole(
        revenueLockersRole,
        revenueLockers.address
      );
      const newRevenueLockersHasRoleAfter = await feePool.hasRole(
        revenueLockersRole,
        newRevenueLockers
      );

      await feePool.setFeeRecipient(
        feeRecipientEnum.revenueLockers,
        revenueLockersBefore
      );

      expect(revenueLockersBefore).to.equal(revenueLockers.address);
      expect(revenueLockersBefore).to.not.equal(revenueLockersAfter);
      expect(revenueLockersAfter).to.equal(notAdmin.address);
      expect(revenueLockersHasRoleBefore).to.equal(true);
      expect(revenueLockersHasRoleAfter).to.equal(false);
      expect(newRevenueLockersHasRoleBefore).to.equal(false);
      expect(newRevenueLockersHasRoleAfter).to.equal(true);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.revenueLockers);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);
      expect(revenueLockersBefore).to.equal(await feePool.revenueLockers());
      expect(
        await feePool.hasRole(revenueLockersRole, revenueLockersBefore)
      ).to.equal(true);
    });

    it('Should set contributors', async () => {
      const newContributors = notAdmin.address;
      const contributorsRole = await feePool.CONTRIBUTORS_ROLE();
      const contributorsBefore = await feePool.contributors();
      const contributorsHasRoleBefore = await feePool.hasRole(
        contributorsRole,
        contributors.address
      );
      const newContributorsHasRoleBefore = await feePool.hasRole(
        contributorsRole,
        newContributors
      );
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.contributors,
        newContributors,
      ]);
      const contributorsAfter = await feePool.contributors();
      const contributorsHasRoleAfter = await feePool.hasRole(
        contributorsRole,
        contributors.address
      );
      const newContributorsHasRoleAfter = await feePool.hasRole(
        contributorsRole,
        newContributors
      );

      await feePool.setFeeRecipient(
        feeRecipientEnum.contributors,
        contributorsBefore
      );

      expect(contributorsBefore).to.equal(contributors.address);
      expect(contributorsBefore).to.not.equal(contributorsAfter);
      expect(contributorsAfter).to.equal(notAdmin.address);
      expect(contributorsHasRoleBefore).to.equal(true);
      expect(contributorsHasRoleAfter).to.equal(false);
      expect(newContributorsHasRoleBefore).to.equal(false);
      expect(newContributorsHasRoleAfter).to.equal(true);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.contributors);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);
      expect(contributorsBefore).to.equal(await feePool.contributors());
      expect(
        await feePool.hasRole(contributorsRole, contributorsBefore)
      ).to.equal(true);
    });
  });

  describe('setFeePercent', () => {
    it('Should revert if percents sum is not 100', async () => {
      const invalidPercents = {
        treasury: 0,
        revenueLockers: 1,
        contributors: 100,
      };

      await expect(
        feePool.setFeePercents(
          invalidPercents.treasury,
          invalidPercents.revenueLockers,
          invalidPercents.contributors
        )
      ).to.be.revertedWith('InvalidFeePercent()');
    });

    it('Should revert if not called by admin', async () => {
      const adminRole = await feePool.DEFAULT_ADMIN_ROLE();
      const percents = {
        treasury: 40,
        revenueLockers: 40,
        contributors: 20,
      };

      await expect(
        feePool
          .connect(notAdmin)
          .setFeePercents(
            percents.treasury,
            percents.revenueLockers,
            percents.contributors
          )
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should revert if not called by admin', async () => {
      const percents = {
        treasury: 40,
        revenueLockers: 40,
        contributors: 20,
      };
      const percentsBefore = {
        treasury: await feePool.treasuryPercent(),
        revenueLockers: await feePool.revenueLockersPercent(),
        contributors: await feePool.contributorsPercent(),
      };
      const [setEvent] = await callAndReturnEvents(feePool.setFeePercents, [
        percents.treasury,
        percents.revenueLockers,
        percents.contributors,
      ]);
      const percentsAfter = {
        treasury: await feePool.treasuryPercent(),
        revenueLockers: await feePool.revenueLockersPercent(),
        contributors: await feePool.contributorsPercent(),
      };

      expect(percents).to.not.deep.equal(percentsBefore);
      expect(percents).to.deep.equal(percentsAfter);
      expect(setEvent.eventSignature).to.equal(
        'SetFeePercents(uint8,uint8,uint8)'
      );
      expect(setEvent.args._treasuryPercent).to.equal(percents.treasury);
      expect(setEvent.args._revenueLockersPercent).to.equal(
        percents.revenueLockers
      );
      expect(setEvent.args._contributorsPercent).to.equal(
        percents.contributors
      );
    });
  });
});
