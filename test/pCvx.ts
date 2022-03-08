import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  setUpConvex,
  callAndReturnEvent,
  callAndReturnEvents,
  toBN,
} from './helpers';
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
      const _cvx = await pCvx.CVX();
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

  describe('setDelegationSpace', () => {
    it('Should update upCvxImplementation', async () => {
      const oldImplementation = await pCvx.upCvxImplementation();
      const newImplementation = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setUpCvxImplementation, [
        newImplementation,
      ]);

      // Revert change to appropriate value
      await pCvx.setUpCvxImplementation(oldImplementation);

      expect(oldImplementation)
        .to.not.equal(newImplementation)
        .to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal(
        'SetUpCvxImplementation(address)'
      );
      expect(setEvent.args._upCvxImplementation)
        .to.equal(newImplementation)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if _upCvxImplementation is zero address', async () => {
      const invalidImplementation = zeroAddress;

      await expect(
        pCvx.setUpCvxImplementation(invalidImplementation)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should if not called by owner', async () => {
      const implementation = admin.address;

      await expect(
        pCvx.connect(notAdmin).setUpCvxImplementation(implementation)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('deposit', () => {
    it('Should deposit CVX', async () => {
      const balanceBefore = await cvx.balanceOf(admin.address);
      const lockBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const msgSender = admin.address;
      const to = admin.address;
      const depositAmount = toBN(1e18);

      await cvx.approve(pCvx.address, depositAmount);

      const events = await callAndReturnEvents(pCvx.deposit, [
        to,
        depositAmount,
      ]);
      const mintEvent = events[0];
      const depositEvent = events[1];
      const transferEvent = events[2];
      const approvalEvent = events[4];
      const balanceAfter = await cvx.balanceOf(admin.address);
      const lockBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);

      expect(balanceAfter)
        .to.equal(balanceBefore.sub(depositAmount))
        .to.not.equal(0);
      expect(mintEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(mintEvent.args.from).to.equal(zeroAddress);
      expect(mintEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintEvent.args.value).to.equal(depositAmount).to.not.equal(0);
      expect(depositEvent.eventSignature).to.equal('Deposit(address,uint256)');
      expect(depositEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(depositEvent.args.amount).to.equal(depositAmount).to.not.equal(0);
      expect(lockBalanceAfter)
        .to.equal(lockBalanceBefore.add(depositAmount))
        .to.not.equal(0);
      expect(transferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(transferEvent.args.from)
        .to.equal(msgSender)
        .to.not.equal(zeroAddress);
      expect(transferEvent.args.to)
        .to.equal(pCvx.address)
        .to.not.equal(zeroAddress);
      expect(transferEvent.args.value).to.equal(depositAmount).to.not.equal(0);
      expect(approvalEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(approvalEvent.args.owner)
        .to.equal(pCvx.address)
        .to.not.equal(zeroAddress);
      expect(approvalEvent.args.spender)
        .to.equal(cvxLocker.address)
        .to.not.equal(zeroAddress);
      expect(approvalEvent.args.value).to.equal(depositAmount).to.not.equal(0);
    });

    it('Should if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const depositAmount = toBN(1e18);

      await expect(pCvx.deposit(invalidTo, depositAmount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should if amount is zero', async () => {
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.deposit(to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });
  });

  describe('initiateRedemption', () => {
    it('Should initiate a redemption', async () => {
      const balanceBefore = await pCvx.balanceOf(admin.address);
      const currentEpoch = await pCvx.getCurrentEpoch();
      const msgSender = admin.address;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const events = await callAndReturnEvents(pCvx.initiateRedemption, [
        to,
        redemptionAmount,
      ]);
      const burnEvent = events[0];
      const initiateEvent = events[1];
      const createdUpCvxEvent = events[2];
      const mintUpCvxEvent = events[3];
      const balanceAfter = await pCvx.balanceOf(admin.address);
      const upCvx = await pCvx.upCvxByEpoch(currentEpoch);

      expect(balanceAfter).to.equal(balanceBefore.sub(redemptionAmount));
      expect(burnEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(burnEvent.args.from).to.equal(msgSender).to.not.equal(zeroAddress);
      expect(burnEvent.args.to).to.equal(zeroAddress);
      expect(burnEvent.args.value).to.equal(redemptionAmount).to.not.equal(0);
      expect(initiateEvent.eventSignature).to.equal(
        'InitiateRedemption(uint256,address,uint256)'
      );
      expect(initiateEvent.args.epoch).to.equal(currentEpoch).to.not.equal(0);
      expect(initiateEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(initiateEvent.args.amount)
        .to.equal(redemptionAmount)
        .to.not.equal(0);
      expect(createdUpCvxEvent.eventSignature).to.equal(
        'CreatedUpCvx(uint256,address)'
      );
      expect(createdUpCvxEvent.args.epoch)
        .to.equal(currentEpoch)
        .to.not.equal(0);
      expect(createdUpCvxEvent.args.instance)
        .to.equal(upCvx)
        .to.not.equal(zeroAddress);
      expect(mintUpCvxEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(mintUpCvxEvent.args.from).to.equal(zeroAddress);
      expect(mintUpCvxEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintUpCvxEvent.args.value)
        .to.equal(redemptionAmount)
        .to.not.equal(0);
    });

    it('Should revert if amount is zero', async () => {
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(
        pCvx.initiateRedemption(to, invalidAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if pCvx balance is insufficient', async () => {
      const balance = await pCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      expect(balance.lt(redemptionAmount)).to.equal(true);
      await expect(
        pCvx.initiateRedemption(to, redemptionAmount)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });
  });
});
