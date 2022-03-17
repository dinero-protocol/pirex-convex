import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { uniq } from 'lodash';
import { callAndReturnEvents } from './helpers';
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
      const FEE_DISTRIBUTOR_ROLE = await feePool.FEE_DISTRIBUTOR_ROLE();
      const treasuryPercent = await feePool.treasuryPercent();
      const revenueLockersPercent = await feePool.revenueLockersPercent();
      const contributorsPercent = await feePool.contributorsPercent();

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
      const _treasury = await feePool.treasury();
      const _revenueLockers = await feePool.revenueLockers();
      const _contributors = await feePool.contributors();
      const DEFAULT_ADMIN_ROLE = await feePool.DEFAULT_ADMIN_ROLE();
      const FEE_DISTRIBUTOR_ROLE = await feePool.FEE_DISTRIBUTOR_ROLE();
      const adminHasRole = await feePool.hasRole(
        DEFAULT_ADMIN_ROLE,
        admin.address
      );
      const notAdminHasAdminRole = await feePool.hasRole(
        DEFAULT_ADMIN_ROLE,
        notAdmin.address
      );
      const notAdminHasDepositorsRole = await feePool.hasRole(
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
        feePool.grantFeeDistributorRole(invalidDepositor)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if called by non-admin', async () => {
      const distributor = notAdmin.address;
      const adminRole = await feePool.DEFAULT_ADMIN_ROLE();

      await expect(
        feePool.connect(notAdmin).grantFeeDistributorRole(distributor)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should grant the distributor role to an address', async () => {
      const distributorRole = await feePool.FEE_DISTRIBUTOR_ROLE();
      const distributor = notAdmin.address;
      const hasRoleBefore = await feePool.hasRole(distributorRole, distributor);
      const [, grantEvent] = await callAndReturnEvents(
        feePool.grantFeeDistributorRole,
        [distributor]
      );
      const hasRoleAfter = await feePool.hasRole(distributorRole, distributor);

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
      const adminRole = await feePool.DEFAULT_ADMIN_ROLE();

      await expect(
        feePool.connect(notAdmin).revokeFeeDistributorRole(distributor)
      ).to.be.revertedWith(
        `AccessControl: account ${notAdmin.address.toLowerCase()} is missing role ${adminRole}`
      );
    });

    it('Should revoke the fee distributor role from an address', async () => {
      const distributorRole = await feePool.FEE_DISTRIBUTOR_ROLE();
      const distributor = notAdmin.address;
      const hasRoleBefore = await feePool.hasRole(distributorRole, distributor);
      const [, revokeEvent] = await callAndReturnEvents(
        feePool.revokeFeeDistributorRole,
        [distributor]
      );
      const hasRoleAfter = await feePool.hasRole(distributorRole, distributor);

      expect(hasRoleBefore).to.equal(true);
      expect(hasRoleAfter).to.equal(false);
      expect(revokeEvent.eventSignature).to.equal(
        'RevokeFeeDistributorRole(address)'
      );
      expect(revokeEvent.args.distributor).to.equal(distributor);
    });

    it('Should revert if address is not a distributor', async () => {
      const distributorRole = await feePool.FEE_DISTRIBUTOR_ROLE();
      const invalidDistributor1 = notAdmin.address;
      const invalidDistributor2 = zeroAddress;
      const distributor1HasRole = await feePool.hasRole(
        distributorRole,
        invalidDistributor1
      );

      expect(distributor1HasRole).to.equal(false);
      await expect(
        feePool.revokeFeeDistributorRole(invalidDistributor1)
      ).to.be.revertedWith('NotFeeDistributor()');
      await expect(
        feePool.revokeFeeDistributorRole(invalidDistributor2)
      ).to.be.revertedWith('NotFeeDistributor()');
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
      const treasuryBefore = await feePool.treasury();
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.treasury,
        newTreasury,
      ]);
      const treasuryAfter = await feePool.treasury();

      // Revert change to appropriate value for future tests
      await feePool.setFeeRecipient(feeRecipientEnum.treasury, treasuryBefore);

      expect(treasuryBefore).to.equal(treasury.address);
      expect(treasuryBefore).to.not.equal(treasuryAfter);
      expect(treasuryAfter).to.equal(notAdmin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetFeeRecipient(uint8,address)'
      );
      expect(setEvent.args.f).to.equal(feeRecipientEnum.treasury);
      expect(setEvent.args.recipient).to.equal(notAdmin.address);

      // Test change reversion
      expect(treasuryBefore).to.equal(await feePool.treasury());
    });

    it('Should set revenueLockers', async () => {
      const newRevenueLockers = notAdmin.address;
      const revenueLockersBefore = await feePool.revenueLockers();
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.revenueLockers,
        newRevenueLockers,
      ]);
      const revenueLockersAfter = await feePool.revenueLockers();

      await feePool.setFeeRecipient(
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
      expect(revenueLockersBefore).to.equal(await feePool.revenueLockers());
    });

    it('Should set contributors', async () => {
      const newContributors = notAdmin.address;
      const contributorsBefore = await feePool.contributors();
      const [setEvent] = await callAndReturnEvents(feePool.setFeeRecipient, [
        feeRecipientEnum.contributors,
        newContributors,
      ]);
      const contributorsAfter = await feePool.contributors();

      await feePool.setFeeRecipient(
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
      expect(contributorsBefore).to.equal(await feePool.contributors());
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
