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
  MultiMerkleStash,
} from '../typechain-types';
import { BalanceTree } from '../lib/merkle';

describe('PirexCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;
  let cvxDelegateRegistry: DelegateRegistry;
  let votiumMultiMerkleStash: MultiMerkleStash;

  let depositEpoch: BigNumber;

  const delegationSpace = 'cvx.eth';
  const delegationSpaceBytes32 =
    ethers.utils.formatBytes32String(delegationSpace);
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const epochDuration = toBN(1209600);
  const contractEnum = {
    cvxLocker: 0,
    cvxDelegateRegistry: 1,
    upCvx: 2,
    vpCvx: 3,
    rpCvx: 4,
  };
  const futuresEnum = {
    vote: 0,
    reward: 1,
  };
  const getFuturesCvxBalances = async (
    rounds: number,
    futures: number,
    currentEpoch: BigNumber
  ) =>
    await Promise.reduce(
      [...Array(rounds).keys()],
      async (acc: BigNumber[], _: number, idx: number) => {
        const epoch: BigNumber = currentEpoch
          .add(epochDuration)
          .add(epochDuration.mul(idx));
        const futuresCvx: any = await ethers.getContractAt(
          'ERC1155PresetMinterPauserSupply',
          futures === futuresEnum.vote ? await pCvx.vpCvx() : await pCvx.rpCvx()
        );

        return [...acc, await futuresCvx.balanceOf(admin.address, epoch)];
      },
      []
    );

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();
    ({ cvx, cvxLocker, cvxDelegateRegistry, votiumMultiMerkleStash } =
      await setUpConvex());
    pCvx = await (
      await ethers.getContractFactory('PirexCvx')
    ).deploy(
      cvx.address,
      cvxLocker.address,
      cvxDelegateRegistry.address,
      votiumMultiMerkleStash.address
    );
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const _CVX = await pCvx.CVX();
      const _EPOCH_DURATION = await pCvx.EPOCH_DURATION();
      const _UNLOCKING_DURATION = await pCvx.UNLOCKING_DURATION();
      const _REDEMPTION_FUTURES_ROUNDS = await pCvx.REDEMPTION_FUTURES_ROUNDS();
      const _cvxLocker = await pCvx.cvxLocker();
      const _cvxDelegateRegistry = await pCvx.cvxDelegateRegistry();
      const _upCvx = await pCvx.upCvx();
      const _vpCvx = await pCvx.vpCvx();
      const _rpCvx = await pCvx.rpCvx();
      const _spCvxImplementation = await pCvx.spCvxImplementation();
      const _delegationSpace = await pCvx.delegationSpace();
      const _cvxOutstanding = await pCvx.cvxOutstanding();
      const _name = await pCvx.name();
      const _symbol = await pCvx.symbol();
      const epochSnapshotId = await pCvx.epochSnapshotIds(
        await pCvx.getCurrentEpoch()
      );

      expect(_CVX).to.equal(cvx.address);
      expect(_EPOCH_DURATION).to.equal(1209600);
      expect(_UNLOCKING_DURATION).to.equal(10281600);
      expect(_REDEMPTION_FUTURES_ROUNDS).to.equal(8);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry.address);
      expect(_upCvx).to.not.equal(zeroAddress);
      expect(_vpCvx).to.not.equal(zeroAddress);
      expect(_rpCvx).to.not.equal(zeroAddress);
      expect(_spCvxImplementation).to.not.equal(zeroAddress);
      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
      expect(_cvxOutstanding).to.equal(0);
      expect(_name).to.equal('Pirex CVX');
      expect(_symbol).to.equal('pCVX');
      expect(epochSnapshotId).to.equal(1);
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should return the current epoch', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const expectedEpoch = toBN(
        (await ethers.provider.getBlock('latest')).timestamp
      )
        .div(epochDuration)
        .mul(epochDuration);

      expect(currentEpoch).to.not.equal(0);
      expect(currentEpoch).to.equal(expectedEpoch);
    });
  });

  describe('snapshot', () => {
    it('Should not take a snapshot if already taken', async () => {
      const epochSnapshotId = await pCvx.epochSnapshotIds(
        await pCvx.getCurrentEpoch()
      );
      const snapshotIdBefore = await pCvx.getCurrentSnapshotId();

      await pCvx.snapshot();

      const snapshotIdAfter = await pCvx.getCurrentSnapshotId();

      expect(epochSnapshotId).to.equal(snapshotIdBefore);
      expect(snapshotIdAfter).to.equal(snapshotIdBefore);
    });

    it('Should take a snapshot it not taken', async () => {
      await increaseBlockTimestamp(Number(epochDuration));

      const currentEpoch = await pCvx.getCurrentEpoch();
      const snapshotIdBefore = await pCvx.getCurrentSnapshotId();
      const epochSnapshotIdBefore = await pCvx.epochSnapshotIds(currentEpoch);
      const snapshotEvent = await callAndReturnEvent(pCvx.snapshot, []);
      const snapshotIdAfter = await pCvx.getCurrentSnapshotId();
      const epochSnapshotIdAfter = await pCvx.epochSnapshotIds(currentEpoch);

      expect(epochSnapshotIdBefore).to.equal(0);
      expect(epochSnapshotIdAfter).to.not.equal(epochSnapshotIdBefore);
      expect(epochSnapshotIdAfter).to.equal(snapshotIdAfter);
      expect(snapshotIdAfter).to.not.equal(snapshotIdBefore);
      expect(snapshotIdAfter).to.equal(snapshotIdBefore.add(1));
      expect(snapshotEvent.eventSignature).to.equal('Snapshot(uint256)');
      expect(snapshotEvent.args.id).to.equal(snapshotIdAfter);
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

    it('Should set upCvx', async () => {
      const implementationBefore = await pCvx.upCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.upCvx,
        admin.address,
      ]);
      const implementationAfter = await pCvx.upCvx();

      // Revert change to appropriate value
      await pCvx.setContract(contractEnum.upCvx, implementationBefore);

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.upCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.upCvx());
    });

    it('Should set vpCvx', async () => {
      const implementationBefore = await pCvx.vpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.vpCvx,
        admin.address,
      ]);
      const implementationAfter = await pCvx.vpCvx();

      // Revert change to appropriate value
      await pCvx.setContract(contractEnum.vpCvx, implementationBefore);

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.vpCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.vpCvx());
    });

    it('Should set rpCvx', async () => {
      const implementationBefore = await pCvx.rpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.rpCvx,
        admin.address,
      ]);
      const implementationAfter = await pCvx.rpCvx();

      // Revert change to appropriate value
      await pCvx.setContract(contractEnum.rpCvx, implementationBefore);

      expect(implementationBefore).to.not.equal(implementationAfter);
      expect(implementationBefore).to.not.equal(zeroAddress);
      expect(implementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.rpCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(implementationBefore).to.equal(await pCvx.rpCvx());
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

  describe('setVoteDelegate', () => {
    it('Should set voteDelegate', async () => {
      const voteDelegateBefore = await pCvx.voteDelegate();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
      );
      const voteDelegate = admin.address;
      const events = await callAndReturnEvents(pCvx.setVoteDelegate, [
        voteDelegate,
      ]);
      const setEvent = events[0];
      const voteDelegateAfter = await pCvx.voteDelegate();
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
      );

      expect(voteDelegateBefore).to.equal(zeroAddress);
      expect(convexDelegateBefore).to.equal(zeroAddress);
      expect(voteDelegateAfter).to.not.equal(voteDelegateBefore);
      expect(voteDelegateAfter).to.equal(voteDelegate);
      expect(convexDelegateAfter).to.not.equal(convexDelegateBefore);
      expect(convexDelegateAfter).to.equal(voteDelegate);
      expect(setEvent.eventSignature).to.equal('SetVoteDelegate(address)');
      expect(setEvent.args._voteDelegate).to.equal(voteDelegate);
    });

    it('Should revert if _voteDelegate is zero address', async () => {
      const invalidVoteDelegate = zeroAddress;

      await expect(
        pCvx.setVoteDelegate(invalidVoteDelegate)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async () => {
      const voteDelegate = admin.address;

      await expect(
        pCvx.connect(notAdmin).setVoteDelegate(voteDelegate)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });
  });

  describe('removeVoteDelegate', () => {
    it('Should remove voteDelegate', async () => {
      const voteDelegateBefore = await pCvx.voteDelegate();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
      );
      const events = await callAndReturnEvents(pCvx.removeVoteDelegate, []);
      const removeEvent = events[0];
      const voteDelegateAfter = await pCvx.voteDelegate();
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
      );

      expect(voteDelegateBefore).to.equal(admin.address);
      expect(convexDelegateBefore).to.equal(admin.address);
      expect(voteDelegateAfter).to.not.equal(voteDelegateBefore);
      expect(voteDelegateAfter).to.equal(zeroAddress);
      expect(convexDelegateAfter).to.not.equal(convexDelegateBefore);
      expect(convexDelegateAfter).to.equal(zeroAddress);
      expect(removeEvent.eventSignature).to.equal('RemoveVoteDelegate()');
    });

    it('Should revert if not called by owner', async () => {
      await expect(
        pCvx.connect(notAdmin).removeVoteDelegate()
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

      depositEpoch = await pCvx.getCurrentEpoch();

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
          'ERC1155PresetMinterPauserSupply',
          await pCvx.upCvx()
        )
      ).balanceOf(admin.address, currentEpoch);
      const rpCvxBalances = await getFuturesCvxBalances(
        8,
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
      expect(
        every(
          rpCvxBalances,
          (v) => v.eq(redemptionAmount) && v.eq(upCvxBalance)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for the same contract if the epoch has not changed', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'ERC1155PresetMinterPauserSupply',
        await pCvx.upCvx()
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        currentEpoch
      );
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        currentEpoch
      );
      const rpCvxBalances = await getFuturesCvxBalances(
        8,
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
          rpCvxBalances,
          (v) => v.gt(redemptionAmount) && v.eq(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for the same contract with a different futures type', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'ERC1155PresetMinterPauserSupply',
        await pCvx.upCvx()
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        currentEpoch
      );
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.vote);

      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        currentEpoch
      );
      const vpCvxBalances = await getFuturesCvxBalances(
        8,
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
          vpCvxBalances,
          (v) => v.eq(redemptionAmount) && v.lt(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should initiate a redemption for a new contract if the epoch has changed', async () => {
      const epochBefore = await pCvx.getCurrentEpoch();

      await increaseBlockTimestamp(Number(epochDuration));

      const epochAfter = await pCvx.getCurrentEpoch();
      const upCvx = await ethers.getContractAt(
        'ERC1155PresetMinterPauserSupply',
        await pCvx.upCvx()
      );
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const to = admin.address;
      const redemptionAmount = toBN(1e18);

      await pCvx.initiateRedemption(to, redemptionAmount, futuresEnum.reward);

      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const upCvxBalanceEpochBefore = await upCvx.balanceOf(
        admin.address,
        epochBefore
      );
      const upCvxBalanceEpochAfter = await upCvx.balanceOf(
        admin.address,
        epochAfter
      );

      expect(epochAfter).to.not.equal(0);
      expect(epochAfter).to.equal(epochBefore.add(epochDuration));
      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(upCvxBalanceEpochAfter).to.not.equal(0);
      expect(upCvxBalanceEpochAfter).to.not.equal(upCvxBalanceEpochBefore);
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

  describe('redeem', () => {
    it('Should revert if before lock expiry', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(pCvx.redeem(currentEpoch, to, amount)).to.be.revertedWith(
        'BeforeLockExpiry()'
      );
    });

    it('Should revert if insufficient upCVX balance for epoch', async () => {
      const invalidEpoch = (await pCvx.getCurrentEpoch()).add(1);
      const to = admin.address;
      const amount = toBN(1e18);

      const upCvx = await ethers.getContractAt(
        'ERC1155PresetMinterPauserSupply',
        await pCvx.upCvx()
      );
      const upCvxBalance = await upCvx.balanceOf(admin.address, invalidEpoch);

      await upCvx.setApprovalForAll(pCvx.address, true);
      await increaseBlockTimestamp(10281601);

      const { timestamp } = await ethers.provider.getBlock('latest');

      expect(upCvxBalance).to.equal(0);
      expect(
        invalidEpoch.add(await pCvx.UNLOCKING_DURATION()).lt(timestamp)
      ).to.equal(true);
      await expect(pCvx.redeem(invalidEpoch, to, amount)).to.be.revertedWith(
        // Caused by ERC1155Supply _beforeTokenTransfer hook
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should revert if amount is zero', async () => {
      const epoch = depositEpoch;
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.redeem(epoch, to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should redeem CVX', async () => {
      const epoch = depositEpoch;
      const to = admin.address;
      const amount = toBN(1e18);
      const upCvx = await ethers.getContractAt(
        'ERC1155PresetMinterPauserSupply',
        await pCvx.upCvx()
      );
      const upCvxBalanceBefore = await upCvx.balanceOf(admin.address, epoch);
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const events = await callAndReturnEvents(pCvx.redeem, [
        epoch,
        to,
        amount,
      ]);
      const upCvxBalanceAfter = await upCvx.balanceOf(admin.address, epoch);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const redeemEvent = events[0];

      expect(upCvxBalanceAfter).to.equal(upCvxBalanceBefore.sub(amount));
      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(amount));
      expect(redeemEvent.eventSignature).to.equal(
        'Redeem(uint256,address,uint256)'
      );
      expect(redeemEvent.args.epoch).to.equal(epoch);
      expect(redeemEvent.args.to).to.equal(to);
      expect(redeemEvent.args.amount).to.equal(amount);
    });
  });

  describe('stake', () => {
    it('Should revert if rounds is zero', async () => {
      const invalidRounds = 0;
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(invalidRounds, to, amount, f)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if amount is zero', async () => {
      const rounds = 1;
      const to = admin.address;
      const invalidAmount = toBN(0);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(rounds, to, invalidAmount, f)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should stake pCVX', async () => {
      const rounds = 26;
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const events = await callAndReturnEvents(pCvx.stake, [
        rounds,
        to,
        amount,
        f,
      ]);
      const stakeEvent = events[2];
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const spCvx = await pCvx.getSpCvx();
      const vault = await ethers.getContractAt(
        'StakedPirexCvx',
        spCvx[spCvx.length - 1]
      );
      const rpCvxBalances = await getFuturesCvxBalances(
        rounds,
        f,
        await pCvx.getCurrentEpoch()
      );
      const vaultUnderlyingBalance = await pCvx.balanceOf(vault.address);
      const toUnderlyingBalance = await vault.balanceOfUnderlying(to);
      const toVaultShareBalance = await vault.balanceOf(to);

      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.sub(amount));
      expect(stakeEvent.eventSignature).to.equal(
        'Stake(uint8,address,uint256,uint8,address)'
      );
      expect(stakeEvent.args.rounds).to.equal(rounds);
      expect(stakeEvent.args.to).to.equal(to);
      expect(stakeEvent.args.amount).to.equal(amount);
      expect(stakeEvent.args.f).to.equal(f);
      expect(stakeEvent.args.vault).to.equal(vault.address);
      expect(rpCvxBalances.length).to.equal(rounds);
      expect(every(rpCvxBalances, (r) => r.eq(amount))).to.equal(true);
      expect(toUnderlyingBalance).to.equal(amount);
      expect(vaultUnderlyingBalance).to.equal(amount);
      expect(toVaultShareBalance).to.equal(amount);
    });
  });

  describe('unstake', () => {
    it('Should revert if vault is zero address', async () => {
      const invalidVault = zeroAddress;
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(pCvx.unstake(invalidVault, to, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if to is zero address', async () => {
      const vault = admin.address;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(pCvx.unstake(vault, invalidTo, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if amount is zero', async () => {
      const vault = admin.address;
      const to = admin.address;
      const invalidAmount = toBN(0);

      await expect(pCvx.unstake(vault, to, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if before stake expiry', async () => {
      const spCvx = await pCvx.getSpCvx();
      const vault = await ethers.getContractAt(
        'StakedPirexCvx',
        spCvx[spCvx.length - 1]
      );
      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);

      await vault.increaseAllowance(pCvx.address, amount);

      await expect(pCvx.unstake(vault.address, to, amount)).to.be.revertedWith(
        'BeforeStakeExpiry()'
      );
    });

    it('Should unstake pCVX', async () => {
      const spCvx = await pCvx.getSpCvx();
      const vault = await ethers.getContractAt(
        'StakedPirexCvx',
        spCvx[spCvx.length - 1]
      );
      const stakeExpiry = await vault.stakeExpiry();
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(Number(stakeExpiry.sub(timestamp)));

      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(to);
      const vaultShareBalanceBefore = await vault.balanceOf(admin.address);

      await vault.increaseAllowance(pCvx.address, amount);

      const events = await callAndReturnEvents(pCvx.unstake, [
        vault.address,
        to,
        amount,
      ]);
      const unstakeEvent = events[0];
      const pCvxBalanceAfter = await pCvx.balanceOf(to);
      const vaultShareBalanceAfter = await vault.balanceOf(admin.address);

      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.add(amount));
      expect(vaultShareBalanceAfter)
        .to.equal(vaultShareBalanceBefore.sub(amount))
        .to.equal(0);
      expect(unstakeEvent.eventSignature).to.equal(
        'Unstake(address,address,uint256)'
      );
      expect(unstakeEvent.args.vault).to.equal(vault.address);
      expect(unstakeEvent.args.to).to.equal(to);
      expect(unstakeEvent.args.amount).to.equal(amount);
    });
  });

  describe('claimVotiumReward', () => {
    let votiumRewardDistribution: { account: string; amount: BigNumber }[];
    let tree: BalanceTree;

    before(async () => {
      votiumRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(1e18),
        },
      ];
      tree = new BalanceTree(votiumRewardDistribution);

      const token = cvx.address;
      const merkleRoot = tree.getHexRoot();

      await cvx.transfer(votiumMultiMerkleStash.address, toBN(1e18));
      await votiumMultiMerkleStash.updateMerkleRoot(token, merkleRoot);
    });

    it('Should claim Votium rewards and set distribution for pCVX and rpCVX token holders', async () => {
      const token = cvx.address;
      const index = 0;
      const account = votiumRewardDistribution[index].account;
      const amount = votiumRewardDistribution[index].amount;
      const merkleProof = tree.getProof(index, account, amount);
      const snapshotSupply = await pCvx.totalSupply();
      const currentEpoch = await pCvx.getCurrentEpoch();
      const epochRpCvxSupply = await (
        await ethers.getContractAt(
          'ERC1155PresetMinterPauserSupply',
          await pCvx.rpCvx()
        )
      ).totalSupply(currentEpoch);
      const expectedSnapshotRewards = {
        tokens: [cvx.address],
        tokenAmounts: [
          amount.mul(snapshotSupply).div(snapshotSupply.add(epochRpCvxSupply)),
        ],
      };
      const expectedFuturesRewards = {
        tokens: [cvx.address],
        tokenAmounts: [amount.sub(expectedSnapshotRewards.tokenAmounts[0])],
      };
      const events = await callAndReturnEvents(pCvx.claimVotiumReward, [
        token,
        index,
        amount,
        merkleProof,
      ]);
      const snapEvent = events[0];
      const claimEvent = events[1];
      const rewards = await pCvx.getRewards(currentEpoch);
      const currentSnapshotId = await pCvx.getCurrentSnapshotId();

      expect(rewards.snapshotTokens).to.deep.equal(
        expectedSnapshotRewards.tokens
      );
      expect(rewards.snapshotTokenAmounts).to.deep.equal(
        expectedSnapshotRewards.tokenAmounts
      );
      expect(rewards.futuresTokens).to.deep.equal(
        expectedFuturesRewards.tokens
      );
      expect(rewards.futuresTokenAmounts).to.deep.equal(
        expectedFuturesRewards.tokenAmounts
      );
      expect(snapEvent.eventSignature).to.equal('Snapshot(uint256)');
      expect(snapEvent.args.id).to.equal(currentSnapshotId);
      expect(claimEvent.eventSignature).to.equal(
        'ClaimVotiumReward(address,uint256,uint256,uint256)'
      );
      expect(claimEvent.args.token).to.equal(token);
      expect(claimEvent.args.index).to.equal(index);
      expect(claimEvent.args.amount).to.equal(amount);
      expect(claimEvent.args.snapshotId).to.equal(currentSnapshotId);
    });
  });
});
