import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { callAndReturnEvents, validateEvent } from './helpers';
import { PirexFees } from '../typechain-types';

describe('PirexFees', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pirexFees: PirexFees;
  let feePercentDenominator: number;

  let zeroAddress: string;

  const feeRecipientEnum = {
    treasury: 0,
    contributors: 1,
  };

  before(async function () {
    ({
      admin,
      notAdmin,
      treasury,
      contributors,
      pirexFees,
      feePercentDenominator,
      zeroAddress,
    } = this);
  });

  describe('initial state', function () {
    it('Should have predefined state variables', async function () {
      const percentDenominator = await pirexFees.PERCENT_DENOMINATOR();
      const treasuryPercent = await pirexFees.treasuryPercent();

      expect(percentDenominator).to.equal(feePercentDenominator).to.equal(100);
      expect(treasuryPercent).to.equal(75);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const _treasury = await pirexFees.treasury();
      const _contributors = await pirexFees.contributors();

      expect(_treasury).to.equal(treasury.address);
      expect(_contributors).to.equal(contributors.address);
    });
  });

  describe('setFeeRecipient', function () {
    it('Should revert if f enum is out of range', async function () {
      const invalidF = feeRecipientEnum.contributors + 1;

      await expect(
        pirexFees.setFeeRecipient(invalidF, admin.address)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if recipient is zero address', async function () {
      const f = feeRecipientEnum.treasury;
      const invalidRecipient = zeroAddress;

      await expect(
        pirexFees.setFeeRecipient(f, invalidRecipient)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by admin', async function () {
      const f = feeRecipientEnum.treasury;
      const recipient = admin.address;

      await expect(
        pirexFees.connect(notAdmin).setFeeRecipient(f, recipient)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set treasury', async function () {
      const newTreasury = notAdmin.address;
      const treasuryBefore = await pirexFees.treasury();
      const [setEvent] = await callAndReturnEvents(pirexFees.setFeeRecipient, [
        feeRecipientEnum.treasury,
        newTreasury,
      ]);
      const treasuryAfter = await pirexFees.treasury();

      // Revert change to appropriate value for future tests
      await pirexFees.setFeeRecipient(
        feeRecipientEnum.treasury,
        treasuryBefore
      );

      expect(treasuryBefore).to.equal(treasury.address);
      expect(treasuryBefore).to.not.equal(treasuryAfter);
      expect(treasuryAfter).to.equal(notAdmin.address);
      validateEvent(setEvent, 'SetFeeRecipient(uint8,address)', {
        f: feeRecipientEnum.treasury,
        recipient: notAdmin.address,
      });

      // Test change reversion
      expect(treasuryBefore).to.equal(await pirexFees.treasury());
    });

    it('Should set contributors', async function () {
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
      validateEvent(setEvent, 'SetFeeRecipient(uint8,address)', {
        f: feeRecipientEnum.contributors,
        recipient: notAdmin.address,
      });
      expect(contributorsBefore).to.equal(await pirexFees.contributors());
    });
  });

  describe('setTreasuryPercent', function () {
    it('Should revert if treasuryPercent is greater than 75', async function () {
      const invalidTreasuryPercent = 76;

      await expect(
        pirexFees.setTreasuryPercent(invalidTreasuryPercent)
      ).to.be.revertedWith('InvalidFeePercent()');
    });

    it('Should revert if not called by admin', async function () {
      const treasuryPercent = 50;

      await expect(
        pirexFees.connect(notAdmin).setTreasuryPercent(treasuryPercent)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if not called by admin', async function () {
      const treasuryPercent = 50;
      const treasuryPercentBefore = await pirexFees.treasuryPercent();
      const [setEvent] = await callAndReturnEvents(
        pirexFees.setTreasuryPercent,
        [treasuryPercent]
      );
      const treasuryPercentAfter = await pirexFees.treasuryPercent();

      expect(treasuryPercentAfter).to.not.equal(treasuryPercentBefore);
      expect(treasuryPercent).to.equal(treasuryPercentAfter);
      validateEvent(setEvent, 'SetTreasuryPercent(uint8)', {
        _treasuryPercent: treasuryPercent,
      });
    });
  });
});
