import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { uniq } from 'lodash';
import { callAndReturnEvents } from './helpers';
import { PirexFees } from '../typechain-types';

describe('PirexFees', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let revenueLockers: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pirexFees: PirexFees;

  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const feeRecipientEnum = {
    treasury: 0,
    revenueLockers: 1,
    contributors: 2,
  };

  before(async () => {
    [admin, notAdmin, treasury, revenueLockers, contributors] =
      await ethers.getSigners();
    pirexFees = await (
      await ethers.getContractFactory('PirexFees')
    ).deploy(treasury.address, revenueLockers.address, contributors.address);
  });

  describe('initial state', () => {
    it('Should have predefined state variables', async () => {
      const PERCENT_DENOMINATOR = await pirexFees.PERCENT_DENOMINATOR();
      const FEE_DISTRIBUTOR_ROLE = await pirexFees.FEE_DISTRIBUTOR_ROLE();
      const treasuryPercent = await pirexFees.treasuryPercent();
      const revenueLockersPercent = await pirexFees.revenueLockersPercent();
      const contributorsPercent = await pirexFees.contributorsPercent();

      expect(PERCENT_DENOMINATOR).to.equal(100);
      expect(FEE_DISTRIBUTOR_ROLE).to.equal(
        ethers.utils.formatBytes32String('FEE_DISTRIBUTOR')
      );
      expect(treasuryPercent).to.equal(25);
      expect(revenueLockersPercent).to.equal(50);
      expect(contributorsPercent).to.equal(25);
    });
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const _treasury = await pirexFees.treasury();
      const _revenueLockers = await pirexFees.revenueLockers();
      const _contributors = await pirexFees.contributors();
      const DEFAULT_ADMIN_ROLE = await pirexFees.DEFAULT_ADMIN_ROLE();
      const FEE_DISTRIBUTOR_ROLE = await pirexFees.FEE_DISTRIBUTOR_ROLE();
      const adminHasRole = await pirexFees.hasRole(
        DEFAULT_ADMIN_ROLE,
        admin.address
      );
      const notAdminHasAdminRole = await pirexFees.hasRole(
        DEFAULT_ADMIN_ROLE,
        notAdmin.address
      );
      const notAdminHasDepositorsRole = await pirexFees.hasRole(
        FEE_DISTRIBUTOR_ROLE,
        notAdmin.address
      );
      const roles = [DEFAULT_ADMIN_ROLE, FEE_DISTRIBUTOR_ROLE];

      expect(_treasury).to.equal(treasury.address);
      expect(_revenueLockers).to.equal(revenueLockers.address);
      expect(_contributors).to.equal(contributors.address);
      expect(adminHasRole).to.equal(true);
      expect(notAdminHasAdminRole).to.equal(false);
      expect(notAdminHasDepositorsRole).to.equal(false);
      expect(uniq(roles).length).to.equal(roles.length);
    });
  });

  describe('grantFeeDistributorRole', () => {
    it('Should revert if distributor is zero address', async () => {
      const invalidDepositor = zeroAddress;

      await expect(
        pirexFees.grantFeeDistributorRole(invalidDepositor)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if called by non-admin', async () => {
      const distributor = notAdmin.address;
      const adminRole = await pirexFees.DEFAULT_ADMIN_ROLE();

      await expect(
        pirexFees.connect(notAdmin).grantFeeDistributorRole(distributor)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should grant the distributor role to an address', async () => {
      const distributorRole = await pirexFees.FEE_DISTRIBUTOR_ROLE();
      const distributor = notAdmin.address;
      const hasRoleBefore = await pirexFees.hasRole(distributorRole, distributor);
      const [, grantEvent] = await callAndReturnEvents(
        pirexFees.grantFeeDistributorRole,
        [distributor]
      );
      const hasRoleAfter = await pirexFees.hasRole(distributorRole, distributor);

      expect(hasRoleBefore).to.equal(false);
      expect(hasRoleAfter).to.equal(true);
      expect(grantEvent.eventSignature).to.equal(
        'GrantFeeDistributorRole(address)'
      );
      expect(grantEvent.args.distributor).to.equal(notAdmin.address);
    });
  });

  describe('revokeFeeDistributorRole', () => {
    it('Should revert if called by non-admin', async () => {
      const distributor = notAdmin.address;
      const adminRole = await pirexFees.DEFAULT_ADMIN_ROLE();

      await expect(
        pirexFees.connect(notAdmin).revokeFeeDistributorRole(distributor)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should revoke the fee distributor role from an address', async () => {
      const distributorRole = await pirexFees.FEE_DISTRIBUTOR_ROLE();
      const distributor = notAdmin.address;
      const hasRoleBefore = await pirexFees.hasRole(distributorRole, distributor);
      const [, revokeEvent] = await callAndReturnEvents(
        pirexFees.revokeFeeDistributorRole,
        [distributor]
      );
      const hasRoleAfter = await pirexFees.hasRole(distributorRole, distributor);

      expect(hasRoleBefore).to.equal(true);
      expect(hasRoleAfter).to.equal(false);
      expect(revokeEvent.eventSignature).to.equal(
        'RevokeFeeDistributorRole(address)'
      );
      expect(revokeEvent.args.distributor).to.equal(distributor);
    });

    it('Should revert if address is not a distributor', async () => {
      const distributorRole = await pirexFees.FEE_DISTRIBUTOR_ROLE();
      const invalidDistributor1 = notAdmin.address;
      const invalidDistributor2 = zeroAddress;
      const distributor1HasRole = await pirexFees.hasRole(
        distributorRole,
        invalidDistributor1
      );

      expect(distributor1HasRole).to.equal(false);
      await expect(
        pirexFees.revokeFeeDistributorRole(invalidDistributor1)
      ).to.be.revertedWith('NotFeeDistributor()');
      await expect(
        pirexFees.revokeFeeDistributorRole(invalidDistributor2)
      ).to.be.revertedWith('NotFeeDistributor()');
    });
  });

  describe('setFeeRecipient', () => {
    it('Should revert if f enum is out of range', async () => {
      const invalidF = feeRecipientEnum.contributors + 1;

      await expect(
        pirexFees.setFeeRecipient(invalidF, admin.address)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if recipient is zero address', async () => {
      const f = feeRecipientEnum.treasury;
      const invalidRecipient = zeroAddress;

      await expect(
        pirexFees.setFeeRecipient(f, invalidRecipient)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by admin', async () => {
      const f = feeRecipientEnum.treasury;
      const recipient = admin.address;
      const adminRole = await pirexFees.DEFAULT_ADMIN_ROLE();

      await expect(
        pirexFees.connect(notAdmin).setFeeRecipient(f, recipient)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should set treasury', async () => {
      const newTreasury = notAdmin.address;
      const treasuryBefore = await pirexFees.treasury();
      const [setEvent] = await callAndReturnEvents(pirexFees.setFeeRecipient, [
        feeRecipientEnum.treasury,
        newTreasury,
      ]);
      const treasuryAfter = await pirexFees.treasury();

      // Revert change to appropriate value for future tests
      await pirexFees.setFeeRecipient(feeRecipientEnum.treasury, treasuryBefore);

      expect(treasuryBefore).to.equal(treasury.address);
      expect(treasuryBefore).to.not.equal(treasuryAfter);
      expect(treasuryAfter).to.equal(notAdmin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.treasury);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);

      // Test change reversion
      expect(treasuryBefore).to.equal(await pirexFees.treasury());
    });

    it('Should set revenueLockers', async () => {
      const newRevenueLockers = notAdmin.address;
      const revenueLockersBefore = await pirexFees.revenueLockers();
      const [setEvent] = await callAndReturnEvents(pirexFees.setFeeRecipient, [
        feeRecipientEnum.revenueLockers,
        newRevenueLockers,
      ]);
      const revenueLockersAfter = await pirexFees.revenueLockers();

      await pirexFees.setFeeRecipient(
        feeRecipientEnum.revenueLockers,
        revenueLockersBefore
      );

      expect(revenueLockersBefore).to.equal(revenueLockers.address);
      expect(revenueLockersBefore).to.not.equal(revenueLockersAfter);
      expect(revenueLockersAfter).to.equal(notAdmin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.revenueLockers);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);
      expect(revenueLockersBefore).to.equal(await pirexFees.revenueLockers());
    });

    it('Should set contributors', async () => {
      const newContributors = notAdmin.address;
      const contributorsBefore = await pirexFees.contributors();
      const [setEvent] = await callAndReturnEvents(pirexFees.setFeeRecipient, [
        feeRecipientEnum.contributors,
        newContributors,
      ]);
      const contributorsAfter = await pirexFees.contributors();

      await pirexFees.setFeeRecipient(
        feeRecipientEnum.contributors,
        contributorsBefore
      );

      expect(contributorsBefore).to.equal(contributors.address);
      expect(contributorsBefore).to.not.equal(contributorsAfter);
      expect(contributorsAfter).to.equal(notAdmin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.contributors);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);
      expect(contributorsBefore).to.equal(await pirexFees.contributors());
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
        pirexFees.setFeePercents(
          invalidPercents.treasury,
          invalidPercents.revenueLockers,
          invalidPercents.contributors
        )
      ).to.be.revertedWith('InvalidFeePercent()');
    });

    it('Should revert if not called by admin', async () => {
      const adminRole = await pirexFees.DEFAULT_ADMIN_ROLE();
      const percents = {
        treasury: 40,
        revenueLockers: 40,
        contributors: 20,
      };

      await expect(
        pirexFees
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
        treasury: await pirexFees.treasuryPercent(),
        revenueLockers: await pirexFees.revenueLockersPercent(),
        contributors: await pirexFees.contributorsPercent(),
      };
      const [setEvent] = await callAndReturnEvents(pirexFees.setFeePercents, [
        percents.treasury,
        percents.revenueLockers,
        percents.contributors,
      ]);
      const percentsAfter = {
        treasury: await pirexFees.treasuryPercent(),
        revenueLockers: await pirexFees.revenueLockersPercent(),
        contributors: await pirexFees.contributorsPercent(),
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
