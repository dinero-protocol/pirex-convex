import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  setUpConvex,
  callAndReturnEvent,
  callAndReturnEvents,
  toBN,
  increaseBlockTimestamp,
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
  const epochDuration = 1209600;
  const contractEnum = {
    cvxLocker: 0,
    cvxDelegateRegistry: 1,
    upCvxImplementation: 2,
    rpCvxImplementation: 3,
  };
  const futuresEnum = {
    vote: 0,
    reward: 1,
  };

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

  describe('setContract', () => {
    it('Should set cvxLocker', async () => {
      const oldCvxLocker = cvxLocker.address;
      const newCvxLocker = admin.address;
      const cvxLockerBefore = await pCvx.cvxLocker();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.cvxLocker,
        newCvxLocker,
      ]);
      const cvxLockerAfter = await pCvx.cvxLocker();

      // Revert change to appropriate value
      await pCvx.setContract(contractEnum.cvxLocker, oldCvxLocker);

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerBefore).to.equal(oldCvxLocker).to.not.equal(zeroAddress);
      expect(cvxLockerAfter).to.equal(newCvxLocker).to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.cvxLocker);
      expect(setEvent.args.contractAddress).to.equal(newCvxLocker);
    });

    it('Should set cvxDelegateRegistry', async () => {
      const oldCvxDelegateRegistry = cvxDelegateRegistry.address;
      const newCvxDelegateRegistry = admin.address;
      const cvxDelegateRegistryBefore = await pCvx.cvxDelegateRegistry();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.cvxDelegateRegistry,
        newCvxDelegateRegistry,
      ]);
      const cvxDelegateRegistryAfter = await pCvx.cvxDelegateRegistry();

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.cvxDelegateRegistry,
        oldCvxDelegateRegistry
      );

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryBefore)
        .to.equal(oldCvxDelegateRegistry)
        .to.not.equal(zeroAddress);
      expect(cvxDelegateRegistryAfter)
        .to.equal(newCvxDelegateRegistry)
        .to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.cvxDelegateRegistry);
      expect(setEvent.args.contractAddress).to.equal(newCvxDelegateRegistry);
    });

    it('Should set upCvxImplementation', async () => {
      const oldImplementation = await pCvx.upCvxImplementation();
      const newImplementation = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.upCvxImplementation,
        newImplementation,
      ]);

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.upCvxImplementation,
        oldImplementation
      );

      expect(oldImplementation)
        .to.not.equal(newImplementation)
        .to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.upCvxImplementation);
      expect(setEvent.args.contractAddress)
        .to.equal(newImplementation)
        .to.not.equal(zeroAddress);
    });

    it('Should set rpCvxImplementation', async () => {
      const oldImplementation = await pCvx.rpCvxImplementation();
      const newImplementation = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.rpCvxImplementation,
        newImplementation,
      ]);

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.rpCvxImplementation,
        oldImplementation
      );

      expect(oldImplementation)
        .to.not.equal(newImplementation)
        .to.not.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.rpCvxImplementation);
      expect(setEvent.args.contractAddress)
        .to.equal(newImplementation)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if contractAddress is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setContract(contractEnum.cvxLocker, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should if not called by owner', async () => {
      const _cvxLocker = admin.address;

      await expect(
        pCvx.connect(notAdmin).setContract(contractEnum.cvxLocker, _cvxLocker)
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

  describe('deposit', () => {
    it('Should deposit CVX', async () => {
      const balanceBefore = await cvx.balanceOf(admin.address);
      const lockBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const msgSender = admin.address;
      const to = admin.address;
      const depositAmount = toBN(10e18);

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
        futuresEnum.reward,
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
      expect(createdUpCvxEvent.args.contractAddress)
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

    it('Should initiate redemption for the same vault if epoch has not changed', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'UpCvx',
        await pCvx.upCvxByEpoch(currentEpoch)
      );
      const balanceBefore = await upCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const balanceAfter = await upCvx.balanceOf(admin.address);

      expect(balanceAfter)
        .to.equal(balanceBefore.add(redemptionAmount))
        .to.not.equal(0);
    });

    it('Should initiate redemption for a new vault if epoch has changed', async () => {
      const epochBefore = await pCvx.getCurrentEpoch();

      await increaseBlockTimestamp(epochDuration);

      const epochAfter = await pCvx.getCurrentEpoch();
      const upCvxBefore = await ethers.getContractAt(
        'UpCvx',
        await pCvx.upCvxByEpoch(epochBefore)
      );
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const upCvxAfter = await ethers.getContractAt(
        'UpCvx',
        await pCvx.upCvxByEpoch(epochAfter)
      );
      const balanceEpochBefore = await upCvxBefore.balanceOf(admin.address);
      const balanceEpochAfter = await upCvxAfter.balanceOf(admin.address);

      expect(epochAfter).to.not.equal(0);
      expect(epochAfter).to.equal(epochBefore.add(epochDuration));
      expect(balanceEpochAfter).to.not.equal(0);
      expect(balanceEpochAfter).to.not.equal(balanceEpochBefore);
      expect(upCvxAfter.address).to.not.equal(zeroAddress);
      expect(upCvxAfter.address).to.not.equal(upCvxBefore.address);
    });

    it('Should revert if amount is zero', async () => {
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(
        pCvx.initiateRedemption(to, invalidAmount, futuresEnum.reward)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if pCvx balance is insufficient', async () => {
      const balance = await pCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(10e18);

      expect(balance.lt(redemptionAmount)).to.equal(true);
      await expect(
        pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });
  });
});
