import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { setUpConvex, callAndReturnEvent } from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
} from '../typechain-types';

describe('PirexCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;
  let cvxDelegateRegistry: DelegateRegistry;

  const delegationSpace = ethers.utils.formatBytes32String('cvx.eth');
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();
    ({ cvx, cvxLocker, cvxDelegateRegistry } = await setUpConvex());
    pCvx = await (
      await ethers.getContractFactory('PirexCvx')
    ).deploy(cvx.address, cvxLocker.address, cvxDelegateRegistry.address);
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const _cvx = await pCvx.cvx();
      const _cvxLocker = await pCvx.cvxLocker();
      const _cvxDelegateRegistry = await pCvx.cvxDelegateRegistry();
      const _delegationSpace = await pCvx.delegationSpace();

      expect(_cvx).to.equal(cvx.address).to.not.equal(zeroAddress);
      expect(_cvxLocker).to.equal(cvxLocker.address).to.not.equal(zeroAddress);
      expect(_cvxDelegateRegistry)
        .to.equal(cvxDelegateRegistry.address)
        .to.not.equal(zeroAddress);
      expect(_delegationSpace).to.equal(delegationSpace);
    });
  });

  describe('setCvx', () => {
    it('Should update the CVX address', async () => {
      const oldCvx = cvx.address;
      const newCvx = admin.address;
      const cvxBefore = await pCvx.cvx();
      const setEvent = await callAndReturnEvent(pCvx.setCvx, [newCvx]);
      const cvxAfter = await pCvx.cvx();

      // Revert change to appropriate value
      await pCvx.setCvx(oldCvx);

      expect(cvxBefore).to.not.equal(cvxAfter);
      expect(cvxBefore).to.equal(oldCvx).to.not.equal(zeroAddress);
      expect(cvxAfter).to.equal(newCvx).to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetCvx(address)');
      expect(setEvent.args._cvx).to.equal(newCvx).to.not.equal(zeroAddress);
    });

    it('Should revert if _cvx is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(pCvx.setCvx(invalidAddress)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should if not called by owner', async () => {
      const _cvx = admin.address;

      await expect(pCvx.connect(notAdmin).setCvx(_cvx)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });
  });

  describe('setCvxLocker', () => {
    it('Should update the CvxLocker address', async () => {
      const oldCvxLocker = cvxLocker.address;
      const newCvxLocker = admin.address;
      const cvxLockerBefore = await pCvx.cvxLocker();
      const setEvent = await callAndReturnEvent(pCvx.setCvxLocker, [
        newCvxLocker,
      ]);
      const cvxLockerAfter = await pCvx.cvxLocker();

      // Revert change to appropriate value
      await pCvx.setCvxLocker(oldCvxLocker);

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerBefore).to.equal(oldCvxLocker).to.not.equal(zeroAddress);
      expect(cvxLockerAfter).to.equal(newCvxLocker).to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetCvxLocker(address)');
      expect(setEvent.args._cvxLocker)
        .to.equal(newCvxLocker)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if _cvxLocker is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(pCvx.setCvxLocker(invalidAddress)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should if not called by owner', async () => {
      const _cvxLocker = admin.address;

      await expect(
        pCvx.connect(notAdmin).setCvxLocker(_cvxLocker)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('setCvxDelegateRegistry', () => {
    it('Should update the CvxDelegateRegistry address', async () => {
      const oldCvxDelegateRegistry = cvxDelegateRegistry.address;
      const newCvxDelegateRegistry = admin.address;
      const cvxDelegateRegistryBefore = await pCvx.cvxDelegateRegistry();
      const setEvent = await callAndReturnEvent(pCvx.setCvxDelegateRegistry, [
        newCvxDelegateRegistry,
      ]);
      const cvxDelegateRegistryAfter = await pCvx.cvxDelegateRegistry();

      // Revert change to appropriate value
      await pCvx.setCvxDelegateRegistry(oldCvxDelegateRegistry);

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryBefore)
        .to.equal(oldCvxDelegateRegistry)
        .to.not.equal(zeroAddress);
      expect(cvxDelegateRegistryAfter)
        .to.equal(newCvxDelegateRegistry)
        .to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal(
        'SetCvxDelegateRegistry(address)'
      );
      expect(setEvent.args._cvxDelegateRegistry)
        .to.equal(newCvxDelegateRegistry)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if _cvxDelegateRegistry is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setCvxDelegateRegistry(invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should if not called by owner', async () => {
      const _cvxDelegateRegistry = admin.address;

      await expect(
        pCvx.connect(notAdmin).setCvxDelegateRegistry(_cvxDelegateRegistry)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('setDelegationSpace', () => {
    it('Should update delegationSpace', async () => {
      const oldDelegationSpace = delegationSpace;
      const newDelegationSpace = 'test.eth';
      const newDelegationSpaceBytes32 =
        ethers.utils.formatBytes32String(newDelegationSpace);
      const delegationSpaceBefore = await pCvx.delegationSpace();
      const setEvent = await callAndReturnEvent(pCvx.setDelegationSpace, [
        newDelegationSpace,
      ]);
      const delegationSpaceAfter = await pCvx.delegationSpace();

      // Revert change to appropriate value
      await pCvx.setDelegationSpace(oldDelegationSpace);

      expect(delegationSpaceBefore).to.not.equal(delegationSpaceAfter);
      expect(delegationSpaceBefore).to.equal(oldDelegationSpace);
      expect(delegationSpaceAfter).to.equal(newDelegationSpaceBytes32);
      expect(setEvent.eventSignature).to.equal('SetDelegationSpace(string)');
      expect(setEvent.args._delegationSpace).to.equal(newDelegationSpace);
    });

    it('Should revert if _delegationSpace is empty string', async () => {
      const invalidDelegationSpace = '';

      await expect(
        pCvx.setDelegationSpace(invalidDelegationSpace)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should if not called by owner', async () => {
      const delegationSpace = 'cvx.eth';

      await expect(
        pCvx.connect(notAdmin).setDelegationSpace(delegationSpace)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });
});
