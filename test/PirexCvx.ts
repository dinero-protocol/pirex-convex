import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import { BigNumber } from 'ethers';
import { every } from 'lodash';
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

  const delegationSpace = 'cvx.eth';
  const delegationSpaceBytes32 =
    ethers.utils.formatBytes32String(delegationSpace);
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const epochDuration = toBN(1209600);
  const contractEnum = {
    cvxLocker: 0,
    cvxDelegateRegistry: 1,
    upCvxImplementation: 2,
    vpCvxImplementation: 3,
    rpCvxImplementation: 4,
  };
  const futuresEnum = {
    vote: 0,
    reward: 1,
  };
  const getFuturesCvxDetails = async (
    futures: number,
    currentEpoch: BigNumber
  ) =>
    await Promise.reduce(
      [...Array(8).keys()],
      async (
        acc: {
          contracts: string[];
          balances: BigNumber[];
        },
        _: number,
        idx: number
      ) => {
        const epoch: BigNumber = currentEpoch
          .add(epochDuration)
          .add(epochDuration.mul(idx));
        const futuresCvx: any = await ethers.getContractAt(
          'ERC20PresetMinterPauserUpgradeable',
          futures === futuresEnum.vote
            ? await pCvx.vpCvxByEpoch(epoch)
            : await pCvx.rpCvxByEpoch(epoch)
        );

        return {
          contracts: [...acc.contracts, futuresCvx.address],
          balances: [
            ...acc.balances,
            await futuresCvx.balanceOf(admin.address),
          ],
        };
      },
      {
        contracts: [],
        balances: [],
      }
    );

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
      const _upCvxImplementation = await pCvx.upCvxImplementation();
      const _vpCvxImplementation = await pCvx.vpCvxImplementation();
      const _rpCvxImplementation = await pCvx.rpCvxImplementation();

      expect(_cvx).to.equal(cvx.address).to.not.equal(zeroAddress);
      expect(_cvxLocker).to.equal(cvxLocker.address).to.not.equal(zeroAddress);
      expect(_cvxDelegateRegistry)
        .to.equal(cvxDelegateRegistry.address)
        .to.not.equal(zeroAddress);
      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
      expect(_upCvxImplementation).to.not.equal(zeroAddress);
      expect(_vpCvxImplementation).to.not.equal(zeroAddress);
      expect(_rpCvxImplementation).to.not.equal(zeroAddress);
    });
  });

  describe('setContract', () => {
    it('Should set cvxLocker', async () => {
      const cvxLockerBefore = await pCvx.cvxLocker();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.cvxLocker,
        admin.address,
      ]);
      const cvxLockerAfter = await pCvx.cvxLocker();

      // Revert change to appropriate value
      await pCvx.setContract(contractEnum.cvxLocker, cvxLockerBefore);

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerBefore).to.equal(cvxLocker.address);
      expect(cvxLockerAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.cvxLocker);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
    });

    it('Should set cvxDelegateRegistry', async () => {
      const cvxDelegateRegistryBefore = await pCvx.cvxDelegateRegistry();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.cvxDelegateRegistry,
        admin.address,
      ]);
      const cvxDelegateRegistryAfter = await pCvx.cvxDelegateRegistry();

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.cvxDelegateRegistry,
        cvxDelegateRegistryBefore
      );

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryBefore).to.equal(cvxDelegateRegistry.address);
      expect(cvxDelegateRegistryAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.cvxDelegateRegistry);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
    });

    it('Should set upCvxImplementation', async () => {
      const implementationBefore = await pCvx.upCvxImplementation();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.upCvxImplementation,
        admin.address,
      ]);
      const implementationAfter = await pCvx.upCvxImplementation();

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.upCvxImplementation,
        implementationBefore
      );

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.upCvxImplementation);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.upCvxImplementation());
    });

    it('Should set vpCvxImplementation', async () => {
      const implementationBefore = await pCvx.vpCvxImplementation();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.vpCvxImplementation,
        admin.address,
      ]);
      const implementationAfter = await pCvx.vpCvxImplementation();

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.vpCvxImplementation,
        implementationBefore
      );

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.vpCvxImplementation);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.vpCvxImplementation());
    });

    it('Should set rpCvxImplementation', async () => {
      const implementationBefore = await pCvx.rpCvxImplementation();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.rpCvxImplementation,
        admin.address,
      ]);
      const implementationAfter = await pCvx.rpCvxImplementation();

      // Revert change to appropriate value
      await pCvx.setContract(
        contractEnum.rpCvxImplementation,
        implementationBefore
      );

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.rpCvxImplementation);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.rpCvxImplementation());
    });

    it('Should revert if contractAddress is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setContract(contractEnum.cvxLocker, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async () => {
      const _cvxLocker = admin.address;

      await expect(
        pCvx.connect(notAdmin).setContract(contractEnum.cvxLocker, _cvxLocker)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('setDelegationSpace', () => {
    it('Should update delegationSpace', async () => {
      const newDelegationSpace = 'test.eth';
      const newDelegationSpaceBytes32 =
        ethers.utils.formatBytes32String(newDelegationSpace);
      const delegationSpaceBefore = await pCvx.delegationSpace();
      const setEvent = await callAndReturnEvent(pCvx.setDelegationSpace, [
        newDelegationSpace,
      ]);
      const delegationSpaceAfter = await pCvx.delegationSpace();

      // Revert change to appropriate value
      await pCvx.setDelegationSpace(delegationSpace);

      expect(delegationSpaceBefore).to.not.equal(delegationSpaceAfter);
      expect(delegationSpaceBefore).to.equal(delegationSpaceBytes32);
      expect(delegationSpaceAfter).to.equal(newDelegationSpaceBytes32);
      expect(setEvent.eventSignature).to.equal('SetDelegationSpace(string)');
      expect(setEvent.args._delegationSpace).to.equal(newDelegationSpace);
      expect(delegationSpaceBefore).to.equal(await pCvx.delegationSpace());
    });

    it('Should revert if _delegationSpace is an empty string', async () => {
      const invalidDelegationSpace = '';

      await expect(
        pCvx.setDelegationSpace(invalidDelegationSpace)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should revert if not called by owner', async () => {
      await expect(
        pCvx.connect(notAdmin).setDelegationSpace(delegationSpace)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should return the current epoch', async () => {
      const timestamp = toBN(
        (await ethers.provider.getBlock('latest')).timestamp
      );
      const expectedCurrentEpoch = timestamp
        .div(epochDuration)
        .mul(epochDuration);
      const currentEpoch = await pCvx.getCurrentEpoch();

      expect(timestamp).to.not.equal(0);
      expect(expectedCurrentEpoch).to.equal(currentEpoch);
    });
  });

  describe('deposit', () => {
    it('Should deposit CVX', async () => {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const lockBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
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
      const lockerApprovalEvent = events[4];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const lockBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(depositAmount));
      expect(lockBalanceAfter).to.equal(lockBalanceBefore.add(depositAmount));
      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.add(depositAmount));
      expect(mintEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(mintEvent.args.from).to.equal(zeroAddress);
      expect(mintEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintEvent.args.value).to.equal(depositAmount);
      expect(depositEvent.eventSignature).to.equal('Deposit(address,uint256)');
      expect(depositEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(depositEvent.args.amount).to.equal(depositAmount);
      expect(transferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(transferEvent.args.from).to.equal(msgSender);
      expect(transferEvent.args.to).to.equal(pCvx.address);
      expect(transferEvent.args.value).to.equal(depositAmount);
      expect(lockerApprovalEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(lockerApprovalEvent.args.owner).to.equal(pCvx.address);
      expect(lockerApprovalEvent.args.spender).to.equal(cvxLocker.address);
      expect(lockerApprovalEvent.args.value).to.equal(depositAmount);
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const depositAmount = toBN(1e18);

      await expect(pCvx.deposit(invalidTo, depositAmount)).to.be.revertedWith(
        'ERC20: mint to the zero address'
      );
    });

    it('Should revert if amount is zero', async () => {
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.deposit(to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });
  });

  describe('initiateRedemption', () => {
    it('Should initiate a redemption', async () => {
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
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
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalance = await (
        await ethers.getContractAt(
          'ERC20PresetMinterPauserUpgradeable',
          (
            await pCvx.upCvxByEpoch(currentEpoch)
          ).token
        )
      ).balanceOf(admin.address);
      const rpCvxDetails = await getFuturesCvxDetails(
        futuresEnum.reward,
        currentEpoch
      );

      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(burnEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(burnEvent.args.from).to.equal(msgSender).to.not.equal(zeroAddress);
      expect(burnEvent.args.to).to.equal(zeroAddress);
      expect(burnEvent.args.value).to.equal(redemptionAmount);
      expect(initiateEvent.eventSignature).to.equal(
        'InitiateRedemption(address,uint256)'
      );
      expect(initiateEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(initiateEvent.args.amount).to.equal(redemptionAmount);
      expect(upCvxBalance).to.equal(redemptionAmount);
      expect(every(rpCvxDetails.contracts, (c) => c !== zeroAddress)).to.equal(
        true
      );
      expect(
        every(
          rpCvxDetails.balances,
          (v) => v.eq(redemptionAmount) && v.eq(upCvxBalance)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for the same contract if the epoch has not changed', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'ERC20PresetMinterPauserUpgradeable',
        (
          await pCvx.upCvxByEpoch(currentEpoch)
        ).token
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const upCvxBalanceBefore = await upCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceAfter = await upCvx.balanceOf(admin.address);
      const rpCvxDetails = await getFuturesCvxDetails(
        futuresEnum.reward,
        currentEpoch
      );

      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(upCvxBalanceAfter).to.equal(
        upCvxBalanceBefore.add(redemptionAmount)
      );
      expect(
        every(
          rpCvxDetails.balances,
          (v) => v.gt(redemptionAmount) && v.eq(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for the same contract with a different futures type', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'ERC20PresetMinterPauserUpgradeable',
        (
          await pCvx.upCvxByEpoch(currentEpoch)
        ).token
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const upCvxBalanceBefore = await upCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.vote);

      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceAfter = await upCvx.balanceOf(admin.address);
      const rpCvxDetails = await getFuturesCvxDetails(
        futuresEnum.reward,
        currentEpoch
      );
      const vpCvxDetails = await getFuturesCvxDetails(
        futuresEnum.vote,
        currentEpoch
      );

      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(upCvxBalanceAfter).to.equal(
        upCvxBalanceBefore.add(redemptionAmount)
      );
      expect(
        every(
          vpCvxDetails.contracts,
          (c, idx) => c !== rpCvxDetails.contracts[idx]
        )
      );
      expect(
        every(
          vpCvxDetails.balances,
          (v) => v.eq(redemptionAmount) && v.lt(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for a new contract if the epoch has changed', async () => {
      const epochBefore = await pCvx.getCurrentEpoch();

      await increaseBlockTimestamp(Number(epochDuration));

      const epochAfter = await pCvx.getCurrentEpoch();
      const upCvxBefore = await ethers.getContractAt(
        'ERC20PresetMinterPauserUpgradeable',
        (
          await pCvx.upCvxByEpoch(epochBefore)
        ).token
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const upCvxAfter = await ethers.getContractAt(
        'ERC20PresetMinterPauserUpgradeable',
        (
          await pCvx.upCvxByEpoch(epochAfter)
        ).token
      );
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceEpochBefore = await upCvxBefore.balanceOf(
        admin.address
      );
      const upCvxBalanceEpochAfter = await upCvxAfter.balanceOf(admin.address);
      const rpCvxDetailsBefore = await getFuturesCvxDetails(
        futuresEnum.reward,
        epochBefore
      );
      const rpCvxDetailsAfter = await getFuturesCvxDetails(
        futuresEnum.reward,
        epochAfter
      );

      expect(epochAfter).to.not.equal(0);
      expect(epochAfter).to.equal(epochBefore.add(epochDuration));
      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(upCvxBalanceEpochAfter).to.not.equal(0);
      expect(upCvxBalanceEpochAfter).to.not.equal(upCvxBalanceEpochBefore);
      expect(upCvxAfter.address).to.not.equal(zeroAddress);
      expect(upCvxAfter.address).to.not.equal(upCvxBefore.address);
      expect(
        every(
          rpCvxDetailsAfter.contracts,
          (c, idx) => c !== rpCvxDetailsBefore.contracts[idx]
        )
      );
      expect(rpCvxDetailsAfter.contracts[0]).to.equal(
        rpCvxDetailsBefore.contracts[1]
      );
      expect(
        rpCvxDetailsAfter.contracts[rpCvxDetailsAfter.balances.length - 1]
      ).to.not.equal(
        rpCvxDetailsBefore.contracts[rpCvxDetailsBefore.balances.length - 1]
      );
    });

    it('Should revert if amount is zero', async () => {
      const to = admin.address;
      const invalidAmount = toBN(0);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(to, invalidAmount, f)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if pCvx balance is insufficient', async () => {
      const balance = await pCvx.balanceOf(admin.address);
      const to = admin.address;
      const invalidRedemptionAmount = toBN(10e18);
      const f = futuresEnum.reward;

      expect(balance.lt(invalidRedemptionAmount)).to.equal(true);
      await expect(
        pCvx.initiateRedemption(to, invalidRedemptionAmount, f)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('Should revert if futures enum is out of range', async () => {
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const invalidF = futuresEnum.reward + 1;

      await expect(
        pCvx.initiateRedemption(to, redemptionAmount, invalidF)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });
  });
});
