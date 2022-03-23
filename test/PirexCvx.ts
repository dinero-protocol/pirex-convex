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
  randomNumberBetweenRange,
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
  MultiMerkleStash,
  Crv,
  PirexFees,
  CvxRewardPool,
} from '../typechain-types';
import { BalanceTree } from '../lib/merkle';

describe('PirexCvx', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let treasury: SignerWithAddress;
  let revenueLockers: SignerWithAddress;
  let contributors: SignerWithAddress;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let cvx: ConvexToken;
  let crv: Crv;
  let cvxCrvToken: any;
  let cvxLocker: CvxLocker;
  let cvxDelegateRegistry: DelegateRegistry;
  let cvxRewardPool: CvxRewardPool;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let redemptionUnlockTime: number;

  const delegationSpace = 'cvx.eth';
  const delegationSpaceBytes32 =
    ethers.utils.formatBytes32String(delegationSpace);
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const epochDuration = toBN(1209600);
  const contractEnum = {
    pirexFees: 0,
    upCvx: 1,
    vpCvx: 2,
    rpCvx: 3,
    spCvxImplementation: 4,
  };
  const convexContractEnum = {
    cvxLocker: 0,
    cvxDelegateRegistry: 1,
    cvxRewardPool: 2,
  };
  const futuresEnum = {
    vote: 0,
    reward: 1,
  };
  const feesEnum = {
    deposit: 0,
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
          'ERC1155PresetMinterSupply',
          futures === futuresEnum.vote ? await pCvx.vpCvx() : await pCvx.rpCvx()
        );

        return [...acc, await futuresCvx.balanceOf(admin.address, epoch)];
      },
      []
    );
  const getUpCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155PresetMinterSupply', address);
  const getSpCvx = async (address: string) =>
    await ethers.getContractAt('StakedPirexCvx', address);
  const getRpCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155PresetMinterSupply', address);
  const getVpCvx = async (address: string) =>
    await ethers.getContractAt('ERC1155PresetMinterSupply', address);

  before(async () => {
    [admin, notAdmin, treasury, revenueLockers, contributors] =
      await ethers.getSigners();
    ({
      cvx,
      crv,
      cvxCrvToken,
      cvxLocker,
      cvxRewardPool,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
    } = await setUpConvex());
    pirexFees = await (
      await ethers.getContractFactory('PirexFees')
    ).deploy(treasury.address, revenueLockers.address, contributors.address);
    pCvx = await (
      await ethers.getContractFactory('PirexCvx')
    ).deploy(
      cvx.address,
      cvxLocker.address,
      cvxDelegateRegistry.address,
      cvxRewardPool.address,
      pirexFees.address,
      votiumMultiMerkleStash.address
    );

    await pirexFees.grantFeeDistributorRole(pCvx.address);
  });

  describe('initial state', () => {
    it('Should have predefined state variables', async () => {
      const EPOCH_DURATION = await pCvx.EPOCH_DURATION();
      const _delegationSpace = await pCvx.delegationSpace();

      expect(EPOCH_DURATION).to.equal(1209600);
      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
    });
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const { snapshotId } = await pCvx.getEpoch(await pCvx.getCurrentEpoch());
      const _CVX = await pCvx.CVX();
      const _cvxLocker = await pCvx.cvxLocker();
      const _cvxDelegateRegistry = await pCvx.cvxDelegateRegistry();
      const _cvxRewardPool = await pCvx.cvxRewardPool();
      const _pirexFees = await pCvx.pirexFees();
      const _votiumMultiMerkleStash = await pCvx.votiumMultiMerkleStash();
      const upCvx = await pCvx.upCvx();
      const vpCvx = await pCvx.vpCvx();
      const rpCvx = await pCvx.rpCvx();
      const spCvxImplementation = await pCvx.spCvxImplementation();
      const _name = await pCvx.name();
      const _symbol = await pCvx.symbol();

      expect(snapshotId).to.equal(1);
      expect(_CVX).to.equal(cvx.address);
      expect(_CVX).to.not.equal(zeroAddress);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvxLocker).to.not.equal(zeroAddress);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry.address);
      expect(_cvxDelegateRegistry).to.not.equal(zeroAddress);
      expect(_cvxRewardPool).to.equal(cvxRewardPool.address);
      expect(_pirexFees).to.equal(pirexFees.address);
      expect(_pirexFees).to.not.equal(zeroAddress);
      expect(_votiumMultiMerkleStash).to.equal(votiumMultiMerkleStash.address);
      expect(_votiumMultiMerkleStash).to.not.equal(zeroAddress);
      expect(upCvx).to.not.equal(zeroAddress);
      expect(vpCvx).to.not.equal(zeroAddress);
      expect(rpCvx).to.not.equal(zeroAddress);
      expect(spCvxImplementation).to.not.equal(zeroAddress);
      expect(_name).to.equal('Pirex CVX');
      expect(_symbol).to.equal('pCVX');
    });
  });

  describe('setContract', () => {
    it('Should revert if contractAddress is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setContract(contractEnum.pirexFees, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async () => {
      const contractAddr = admin.address;

      await expect(
        pCvx.connect(notAdmin).setContract(contractEnum.pirexFees, contractAddr)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set pirexFees', async () => {
      const pirexFeesBefore = await pCvx.pirexFees();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.pirexFees,
        admin.address,
      ]);
      const pirexFeesAfter = await pCvx.pirexFees();

      await pCvx.setContract(contractEnum.pirexFees, pirexFeesBefore);

      expect(pirexFeesBefore).to.not.equal(pirexFeesAfter);
      expect(pirexFeesAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.pirexFees);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(pirexFeesBefore).to.equal(await pCvx.pirexFees());
    });

    it('Should set upCvx', async () => {
      const upCvxBefore = await pCvx.upCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.upCvx,
        admin.address,
      ]);
      const upCvxAfter = await pCvx.upCvx();

      await pCvx.setContract(contractEnum.upCvx, upCvxBefore);

      expect(upCvxBefore).to.not.equal(upCvxAfter);
      expect(upCvxAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.upCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(upCvxBefore).to.equal(await pCvx.upCvx());
    });

    it('Should set vpCvx', async () => {
      const vpCvxBefore = await pCvx.vpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.vpCvx,
        admin.address,
      ]);
      const vpCvxAfter = await pCvx.vpCvx();

      await pCvx.setContract(contractEnum.vpCvx, vpCvxBefore);

      expect(vpCvxBefore).to.not.equal(vpCvxAfter);
      expect(vpCvxAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.vpCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(vpCvxBefore).to.equal(await pCvx.vpCvx());
    });

    it('Should set rpCvx', async () => {
      const rpCvxBefore = await pCvx.rpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.rpCvx,
        admin.address,
      ]);
      const rpCvxAfter = await pCvx.rpCvx();

      await pCvx.setContract(contractEnum.rpCvx, rpCvxBefore);

      expect(rpCvxBefore).to.not.equal(rpCvxAfter);
      expect(rpCvxAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.rpCvx);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(rpCvxBefore).to.equal(await pCvx.rpCvx());
    });

    it('Should set spCvxImplementation', async () => {
      const spCvxImplementationBefore = await pCvx.spCvxImplementation();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.spCvxImplementation,
        admin.address,
      ]);
      const spCvxImplementationAfter = await pCvx.spCvxImplementation();

      await pCvx.setContract(
        contractEnum.spCvxImplementation,
        spCvxImplementationBefore
      );

      expect(spCvxImplementationBefore).to.not.equal(spCvxImplementationAfter);
      expect(spCvxImplementationAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal('SetContract(uint8,address)');
      expect(setEvent.args.c).to.equal(contractEnum.spCvxImplementation);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(spCvxImplementationBefore).to.equal(
        await pCvx.spCvxImplementation()
      );
    });
  });

  describe('setConvexContract', () => {
    it('Should revert if contractAddress is zero address', async () => {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setConvexContract(convexContractEnum.cvxLocker, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async () => {
      const _cvxLocker = admin.address;

      await expect(
        pCvx
          .connect(notAdmin)
          .setConvexContract(convexContractEnum.cvxLocker, _cvxLocker)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set cvxLocker', async () => {
      const cvxLockerBefore = await pCvx.cvxLocker();
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        convexContractEnum.cvxLocker,
        admin.address,
      ]);
      const cvxLockerAfter = await pCvx.cvxLocker();

      // Revert change to appropriate value for future tests
      await pCvx.setConvexContract(
        convexContractEnum.cvxLocker,
        cvxLockerBefore
      );

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetConvexContract(uint8,address)'
      );
      expect(setEvent.args.c).to.equal(convexContractEnum.cvxLocker);
      expect(setEvent.args.contractAddress).to.equal(admin.address);

      // Test change reversion
      expect(cvxLockerBefore).to.equal(await pCvx.cvxLocker());
    });

    it('Should set cvxDelegateRegistry', async () => {
      const cvxDelegateRegistryBefore = await pCvx.cvxDelegateRegistry();
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        convexContractEnum.cvxDelegateRegistry,
        admin.address,
      ]);
      const cvxDelegateRegistryAfter = await pCvx.cvxDelegateRegistry();

      await pCvx.setConvexContract(
        convexContractEnum.cvxDelegateRegistry,
        cvxDelegateRegistryBefore
      );

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetConvexContract(uint8,address)'
      );
      expect(setEvent.args.c).to.equal(convexContractEnum.cvxDelegateRegistry);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(cvxDelegateRegistryBefore).to.equal(
        await pCvx.cvxDelegateRegistry()
      );
    });

    it('Should set cvxRewardPool', async () => {
      const cvxRewardPoolBefore = await pCvx.cvxRewardPool();
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        convexContractEnum.cvxRewardPool,
        admin.address,
      ]);
      const cvxRewardPoolAfter = await pCvx.cvxRewardPool();

      await pCvx.setConvexContract(
        convexContractEnum.cvxRewardPool,
        cvxRewardPoolBefore
      );

      expect(cvxRewardPoolBefore).to.not.equal(cvxRewardPoolAfter);
      expect(cvxRewardPoolAfter).to.equal(admin.address);
      expect(setEvent.eventSignature).to.equal(
        'SetConvexContract(uint8,address)'
      );
      expect(setEvent.args.c).to.equal(convexContractEnum.cvxRewardPool);
      expect(setEvent.args.contractAddress).to.equal(admin.address);
      expect(cvxRewardPoolBefore).to.equal(await pCvx.cvxRewardPool());
    });
  });

  describe('setFee', () => {
    it('Should revert if f is not valid Fees enum', async () => {
      const invalidF = 2;
      const amount = 1;

      await expect(pCvx.setFee(invalidF, amount)).to.be.reverted;
    });

    it('Should revert if amount is not uint16', async () => {
      const f = feesEnum.deposit;
      const invalidAmount = 2 ** 16;

      await expect(pCvx.setFee(f, invalidAmount)).to.be.reverted;
    });

    it('Should revert if not owner', async () => {
      const f = feesEnum.deposit;
      const amount = 1;

      await expect(pCvx.connect(notAdmin).setFee(f, amount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('Should set the deposit fee', async () => {
      const depositFeeBefore = await pCvx.fees(feesEnum.deposit);
      const amount = 20000;
      const events = await callAndReturnEvents(pCvx.setFee, [
        feesEnum.deposit,
        amount,
      ]);
      const setEvent = events[0];
      const depositFeeAfter = await pCvx.fees(feesEnum.deposit);

      expect(depositFeeBefore).to.equal(0);
      expect(depositFeeAfter).to.equal(amount);
      expect(setEvent.eventSignature).to.equal('SetFee(uint8,uint16)');
      expect(setEvent.args.f).to.equal(feesEnum.deposit);
      expect(setEvent.args.amount).to.equal(amount);
    });

    it('Should set the reward fee', async () => {
      const rewardFeeBefore = await pCvx.fees(feesEnum.reward);
      const amount = 5000;
      const events = await callAndReturnEvents(pCvx.setFee, [
        feesEnum.reward,
        amount,
      ]);
      const setEvent = events[0];
      const rewardFeeAfter = await pCvx.fees(feesEnum.reward);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(amount);
      expect(setEvent.eventSignature).to.equal('SetFee(uint8,uint16)');
      expect(setEvent.args.f).to.equal(feesEnum.reward);
      expect(setEvent.args.amount).to.equal(amount);
    });
  });

  describe('setDelegationSpace', () => {
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

    it('Should update delegationSpace', async () => {
      const newDelegationSpace = 'test.eth';
      const newDelegationSpaceBytes32 =
        ethers.utils.formatBytes32String(newDelegationSpace);
      const delegationSpaceBefore = await pCvx.delegationSpace();
      const setEvent = await callAndReturnEvent(pCvx.setDelegationSpace, [
        newDelegationSpace,
      ]);
      const delegationSpaceAfter = await pCvx.delegationSpace();

      await pCvx.setDelegationSpace(delegationSpace);

      expect(delegationSpaceBefore).to.not.equal(delegationSpaceAfter);
      expect(delegationSpaceAfter).to.equal(newDelegationSpaceBytes32);
      expect(setEvent.eventSignature).to.equal('SetDelegationSpace(string)');
      expect(setEvent.args._delegationSpace).to.equal(newDelegationSpace);
      expect(delegationSpaceBefore).to.equal(await pCvx.delegationSpace());
    });
  });

  describe('setVoteDelegate', () => {
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

    it('Should set voteDelegate', async () => {
      const voteDelegateBefore = await pCvx.voteDelegate();
      const _delegationSpace = await pCvx.delegationSpace();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );
      const voteDelegate = admin.address;
      const events = await callAndReturnEvents(pCvx.setVoteDelegate, [
        voteDelegate,
      ]);
      const setEvent = events[0];
      const voteDelegateAfter = await pCvx.voteDelegate();
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
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
  });

  describe('clearVoteDelegate', () => {
    it('Should revert if not called by owner', async () => {
      await expect(
        pCvx.connect(notAdmin).clearVoteDelegate()
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should remove voteDelegate', async () => {
      const voteDelegateBefore = await pCvx.voteDelegate();
      const _delegationSpace = await pCvx.delegationSpace();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );
      const events = await callAndReturnEvents(pCvx.clearVoteDelegate, []);
      const removeEvent = events[0];
      const voteDelegateAfter = await pCvx.voteDelegate();
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );

      expect(voteDelegateBefore).to.equal(admin.address);
      expect(convexDelegateBefore).to.equal(admin.address);
      expect(voteDelegateAfter).to.not.equal(voteDelegateBefore);
      expect(voteDelegateAfter).to.equal(zeroAddress);
      expect(convexDelegateAfter).to.not.equal(convexDelegateBefore);
      expect(convexDelegateAfter).to.equal(zeroAddress);
      expect(removeEvent.eventSignature).to.equal('ClearVoteDelegate()');
    });
  });

  describe('getCurrentEpoch', () => {
    it('Should return the current epoch', async () => {
      const expectedCurrentEpoch = toBN(
        (await ethers.provider.getBlock('latest')).timestamp
      )
        .div(epochDuration)
        .mul(epochDuration);
      const currentEpoch = await pCvx.getCurrentEpoch();

      expect(expectedCurrentEpoch).to.not.equal(0);
      expect(expectedCurrentEpoch).to.equal(currentEpoch);
    });
  });

  describe('getCurrentSnapshotId', () => {
    it('Should return the current snapshot id', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId } = await pCvx.getEpoch(currentEpoch);
      const currentSnapshotId = await pCvx.getCurrentSnapshotId();

      expect(snapshotId).to.equal(1);
      expect(snapshotId).to.equal(currentSnapshotId);
    });
  });

  describe('deposit', () => {
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

    it('Should revert if msg.sender CVX balance is insufficient', async () => {
      const cvxBalance = await cvx.balanceOf(admin.address);
      const to = admin.address;
      const invalidAmount = cvxBalance.add(1);

      await expect(pCvx.deposit(to, invalidAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('Should deposit CVX', async () => {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const treasuryCvxBalanceBefore = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceBefore = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceBefore = await cvx.balanceOf(
        contributors.address
      );
      const lockedBalanceBefore = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const msgSender = admin.address;
      const to = admin.address;
      const depositAmount = toBN(10e18);
      const depositFee = depositAmount
        .mul(await pCvx.fees(feesEnum.deposit))
        .div(await pCvx.FEE_DENOMINATOR());

      // Necessary since pCVX transfers CVX to itself before locking
      await cvx.approve(pCvx.address, depositAmount);

      const events = await callAndReturnEvents(pCvx.deposit, [
        to,
        depositAmount,
      ]);
      const mintEvent = events[0];
      const depositEvent = events[1];
      const transferEvent = events[2];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const treasuryCvxBalanceAfter = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceAfter = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceAfter = await cvx.balanceOf(
        contributors.address
      );
      const lockedBalanceAfter = await cvxLocker.lockedBalanceOf(pCvx.address);
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const expectedTreasuryFee = depositFee
        .mul(await pirexFees.treasuryPercent())
        .div(await pirexFees.PERCENT_DENOMINATOR());
      const expectedRevenueLockersFee = depositFee
        .mul(await pirexFees.revenueLockersPercent())
        .div(await pirexFees.PERCENT_DENOMINATOR());
      const expectedContributorsFee = depositFee
        .mul(await pirexFees.contributorsPercent())
        .div(await pirexFees.PERCENT_DENOMINATOR());
      const postFeeAmount = depositAmount.sub(depositFee);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(depositAmount));
      expect(treasuryCvxBalanceAfter).to.not.equal(treasuryCvxBalanceBefore);
      expect(treasuryCvxBalanceAfter).to.equal(
        treasuryCvxBalanceBefore.add(expectedTreasuryFee)
      );
      expect(revenueLockersCvxBalanceAfter).to.not.equal(
        revenueLockersCvxBalanceBefore
      );
      expect(revenueLockersCvxBalanceAfter).to.equal(
        revenueLockersCvxBalanceBefore.add(expectedRevenueLockersFee)
      );
      expect(contributorsCvxBalanceAfter).to.not.equal(
        contributorsCvxBalanceBefore
      );
      expect(contributorsCvxBalanceAfter).to.equal(
        contributorsCvxBalanceBefore.add(expectedContributorsFee)
      );
      expect(lockedBalanceAfter).to.equal(
        lockedBalanceBefore.add(postFeeAmount)
      );
      expect(pCvxBalanceAfter).to.equal(pCvxBalanceBefore.add(postFeeAmount));
      expect(mintEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(mintEvent.args.from).to.equal(zeroAddress);
      expect(mintEvent.args.to).to.equal(to);
      expect(mintEvent.args.value).to.equal(postFeeAmount);
      expect(depositEvent.eventSignature).to.equal(
        'Deposit(address,uint256,uint256)'
      );
      expect(depositEvent.args.to).to.equal(to);
      expect(depositEvent.args.shares).to.equal(postFeeAmount);
      expect(depositEvent.args.fee).to.equal(depositFee);
      expect(transferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(transferEvent.args.from).to.equal(msgSender);
      expect(transferEvent.args.to).to.equal(pCvx.address);
      expect(transferEvent.args.value).to.equal(depositAmount);
    });
  });

  describe('initiateRedemption', () => {
    it('Should revert if amount is zero', async () => {
      const lockIndex = 0;
      const to = admin.address;
      const invalidAmount = toBN(0);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if amount is greater than Convex unlock amount', async () => {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const to = admin.address;
      const invalidAmount = toBN(10e18);
      const f = futuresEnum.reward;

      expect(lockData[lockIndex].amount.lt(invalidAmount)).is.true;
      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });

    it('Should revert if to is zero address', async () => {
      const lockIndex = 0;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, invalidTo, amount, f)
      ).to.be.revertedWith('ERC1155: mint to the zero address');
    });

    it('Should revert if pCvx balance is insufficient', async () => {
      await pCvx.transfer(notAdmin.address, toBN(1e18));

      const pCvxBalance = await pCvx.balanceOf(notAdmin.address);
      const lockIndex = 0;
      const to = admin.address;
      const invalidRedemptionAmount = pCvxBalance.add(1);
      const f = futuresEnum.reward;

      expect(pCvxBalance.lt(invalidRedemptionAmount)).to.equal(true);
      await expect(
        pCvx
          .connect(notAdmin)
          .initiateRedemption(lockIndex, to, invalidRedemptionAmount, f)
      ).to.be.revertedWith('ERC20: burn amount exceeds balance');
    });

    it('Should revert if futures enum is out of range', async () => {
      const lockIndex = 0;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const invalidF = futuresEnum.reward + 1;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, redemptionAmount, invalidF)
      ).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should initiate a redemption', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const { unlockTime } = lockData[lockIndex];

      redemptionUnlockTime = unlockTime;

      // Increase timestamp between now and unlock time to test futures notes correctness
      await increaseBlockTimestamp(
        randomNumberBetweenRange(0, Number(toBN(unlockTime).sub(timestamp)))
      );

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );
      const upCvx = await getUpCvx(await pCvx.upCvx());
      const currentEpoch = await pCvx.getCurrentEpoch();
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const msgSender = admin.address;
      const to = admin.address;
      const redemptionAmount = toBN(1e18);
      const f = futuresEnum.reward;
      const events = await callAndReturnEvents(pCvx.initiateRedemption, [
        lockIndex,
        to,
        redemptionAmount,
        f,
      ]);
      const burnEvent = events[0];
      const initiateEvent = events[1];
      const mintFuturesEvent = events[3];
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        unlockTime
      );
      const remainingTime = toBN(unlockTime).sub(timestampAfter);

      let expectedRewardsRounds = remainingTime.div(epochDuration);

      if (
        !toBN(unlockTime).mod(epochDuration).isZero() &&
        remainingTime.lt(epochDuration) &&
        remainingTime.gt(epochDuration.div(2))
      ) {
        expectedRewardsRounds = expectedRewardsRounds.add(1);
      }

      const rpCvxBalances = await getFuturesCvxBalances(
        Number(expectedRewardsRounds),
        futuresEnum.reward,
        currentEpoch
      );

      expect(pCvxBalanceAfter).to.equal(
        pCvxBalanceBefore.sub(redemptionAmount)
      );
      expect(outstandingRedemptionsAfter).to.equal(
        outstandingRedemptionsBefore.add(redemptionAmount)
      );
      expect(upCvxBalanceAfter).to.equal(
        upCvxBalanceBefore.add(redemptionAmount)
      );
      expect(burnEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(burnEvent.args.from).to.equal(msgSender).to.not.equal(zeroAddress);
      expect(burnEvent.args.to).to.equal(zeroAddress);
      expect(burnEvent.args.value).to.equal(redemptionAmount);
      expect(initiateEvent.eventSignature).to.equal(
        'InitiateRedemption(address,address,uint256,uint256)'
      );
      expect(initiateEvent.args.sender).to.equal(admin.address);
      expect(initiateEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(initiateEvent.args.amount).to.equal(redemptionAmount);
      expect(initiateEvent.args.unlockTime).to.equal(unlockTime);
      expect(mintFuturesEvent.eventSignature).to.equal(
        'MintFutures(uint8,address,uint256,uint8)'
      );
      expect(mintFuturesEvent.args.rounds).to.equal(expectedRewardsRounds);
      expect(mintFuturesEvent.args.to).to.equal(to);
      expect(mintFuturesEvent.args.amount).to.equal(redemptionAmount);
      expect(mintFuturesEvent.args.f).to.equal(f);
      expect(
        every(
          rpCvxBalances,
          (v) => v.eq(redemptionAmount) && v.eq(upCvxBalanceAfter)
        )
      ).to.equal(true);
    });

    it('Should revert if insufficient redemption allowance', async () => {
      const { lockData } = await cvxLocker.lockedBalances(pCvx.address);
      const lockIndex = 0;
      const { unlockTime } = lockData[lockIndex];
      const redemptions = await pCvx.redemptions(unlockTime);
      const to = admin.address;
      const invalidAmount = lockData[lockIndex].amount.sub(redemptions).add(1);
      const f = futuresEnum.reward;

      await expect(
        pCvx.initiateRedemption(lockIndex, to, invalidAmount, f)
      ).to.be.revertedWith('InsufficientRedemptionAllowance()');
    });
  });

  describe('redeem', () => {
    it('Should revert if before lock expiry', async () => {
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        pCvx.redeem(redemptionUnlockTime, to, amount)
      ).to.be.revertedWith('BeforeUnlock()');
    });

    it('Should revert if amount is zero', async () => {
      const unlockTime = 0;
      const to = admin.address;
      const amount = 0;

      await expect(pCvx.redeem(unlockTime, to, amount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert if insufficient upCVX balance for epoch', async () => {
      // Does not exist, should not have a valid token balance
      const invalidUnlockTime = toBN(redemptionUnlockTime).add(1);
      const to = admin.address;
      const amount = toBN(1e18);
      const upCvx = await getUpCvx(await pCvx.upCvx());
      const upCvxBalance = await upCvx.balanceOf(
        admin.address,
        invalidUnlockTime
      );
      const { timestamp } = await ethers.provider.getBlock('latest');

      await upCvx.setApprovalForAll(pCvx.address, true);
      await increaseBlockTimestamp(Number(invalidUnlockTime.sub(timestamp)));

      expect(upCvxBalance).to.equal(0);
      await expect(
        pCvx.redeem(invalidUnlockTime, to, amount)
      ).to.be.revertedWith(
        // Caused by ERC1155Supply _beforeTokenTransfer hook
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(
        pCvx.redeem(redemptionUnlockTime, invalidTo, amount)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should redeem CVX', async () => {
      const upCvx = await getUpCvx(await pCvx.upCvx());
      const upCvxBalanceBefore = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime
      );
      const { unlockable: unlockableBefore } = await cvxLocker.lockedBalances(
        pCvx.address
      );
      const { locked: lockedBefore } = await cvxLocker.lockedBalances(
        pCvx.address
      );
      const outstandingRedemptionsBefore = await pCvx.outstandingRedemptions();
      const upCvxTotalSupplyBefore = await upCvx.totalSupply(
        redemptionUnlockTime
      );
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const to = admin.address;
      const amount = upCvxBalanceBefore.div(2);

      // Expected values post-relock and outstandingRedemptions decrementing
      const expectedRelock = unlockableBefore.sub(outstandingRedemptionsBefore);
      const expectedCvxOutstanding = outstandingRedemptionsBefore.sub(amount);
      const expectedPirexCvxBalance = outstandingRedemptionsBefore.sub(amount);
      const expectedLocked = lockedBefore.add(
        unlockableBefore.sub(outstandingRedemptionsBefore)
      );

      // Expected values post-burn
      const expectedUpCvxSupply = upCvxTotalSupplyBefore.sub(amount);
      const expectedUpCvxBalance = upCvxBalanceBefore.sub(amount);

      // Expected values post-CVX transfer
      const expectedCvxBalance = cvxBalanceBefore.add(amount);

      const events = await callAndReturnEvents(pCvx.redeem, [
        redemptionUnlockTime,
        to,
        amount,
      ]);
      const redeemEvent = events[0];
      const upCvxBalanceAfter = await upCvx.balanceOf(
        admin.address,
        redemptionUnlockTime
      );
      const { locked: lockedAfter } = await cvxLocker.lockedBalances(
        pCvx.address
      );
      const outstandingRedemptionsAfter = await pCvx.outstandingRedemptions();
      const upCvxTotalSupplyAfter = await upCvx.totalSupply(
        redemptionUnlockTime
      );
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const pirexCvxBalanceAfter = await cvx.balanceOf(pCvx.address);

      expect(expectedRelock).to.equal(lockedAfter.sub(lockedBefore));
      expect(expectedRelock).to.not.equal(0);
      expect(expectedCvxOutstanding).to.equal(outstandingRedemptionsAfter);
      expect(expectedCvxOutstanding).to.not.equal(0);
      expect(expectedPirexCvxBalance).to.equal(pirexCvxBalanceAfter);
      expect(expectedPirexCvxBalance).to.not.equal(0);
      expect(expectedLocked).to.equal(lockedAfter);
      expect(expectedLocked).to.not.equal(0);
      expect(expectedUpCvxSupply).to.equal(upCvxTotalSupplyAfter);
      expect(expectedUpCvxSupply).to.not.equal(0);
      expect(expectedUpCvxBalance).to.equal(upCvxBalanceAfter);
      expect(expectedUpCvxBalance).to.not.equal(0);
      expect(expectedCvxBalance).to.equal(cvxBalanceAfter);
      expect(expectedCvxBalance).to.not.equal(0);
      expect(redeemEvent.eventSignature).to.equal(
        'Redeem(uint256,address,uint256)'
      );
      expect(redeemEvent.args.epoch).to.equal(redemptionUnlockTime);
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

    it('Should revert if to is zero address', async () => {
      const rounds = 1;
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await expect(pCvx.stake(rounds, invalidTo, amount, f)).to.be.revertedWith(
        'ERC20: mint to the zero address'
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

    it('Should revert if futures enum is out of range', async () => {
      const rounds = 1;
      const to = admin.address;
      const amount = toBN(1e18);
      const invalidF = futuresEnum.reward + 1;

      await expect(pCvx.stake(rounds, to, amount, invalidF)).to.be.revertedWith(
        'Transaction reverted: function was called with incorrect parameters'
      );
    });

    it('Should revert if pCVX balance is insufficient', async () => {
      const rounds = 1;
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;

      await pCvx.transfer(
        notAdmin.address,
        await pCvx.balanceOf(admin.address)
      );

      await expect(pCvx.stake(rounds, to, amount, f)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );

      // Transfer funds back
      await pCvx
        .connect(notAdmin)
        .transfer(admin.address, await pCvx.balanceOf(notAdmin.address));
    });

    it('Should stake pCVX', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const rounds = toBN(255);
      const to = admin.address;
      const amount = toBN(1e18);
      const f = futuresEnum.reward;
      const pCvxBalanceBefore = await pCvx.balanceOf(admin.address);

      // Expected values post-transfer
      const expectedPCvxBalance = pCvxBalanceBefore.sub(amount);

      // Expected values post-initialize
      const expectedStakeExpiry = currentEpoch.add(
        rounds.mul(await pCvx.EPOCH_DURATION())
      );
      const expectedUnderlyingBalance = amount;
      const expectedShareBalance = amount;

      const events = await callAndReturnEvents(pCvx.stake, [
        rounds,
        to,
        amount,
        f,
      ]);
      const transferEvent = events[0];
      const approveEvent = events[1];
      const stakeEvent = events[2];
      const mintFuturesEvent = events[8];
      const spCvx = await pCvx.getSpCvx();
      const spCvxInstance = await getSpCvx(spCvx[spCvx.length - 1]);
      const rpCvxBalances = await getFuturesCvxBalances(
        Number(rounds),
        f,
        currentEpoch
      );
      const pCvxBalanceAfter = await pCvx.balanceOf(admin.address);
      const stakeExpiry = await spCvxInstance.stakeExpiry();
      const underlyingBalance = await pCvx.balanceOf(spCvxInstance.address);
      const shareBalance = await spCvxInstance.balanceOf(to);

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedPCvxBalance).to.not.equal(0);
      expect(expectedStakeExpiry).to.equal(stakeExpiry);
      expect(expectedStakeExpiry).to.not.equal(0);
      expect(expectedUnderlyingBalance).to.equal(underlyingBalance);
      expect(expectedUnderlyingBalance).to.not.equal(0);
      expect(expectedShareBalance).to.equal(shareBalance);
      expect(expectedShareBalance).to.not.equal(0);
      expect(transferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(transferEvent.args.from).to.equal(admin.address);
      expect(transferEvent.args.to).to.equal(pCvx.address);
      expect(transferEvent.args.value).to.equal(amount);
      expect(approveEvent.eventSignature).to.equal(
        'Approval(address,address,uint256)'
      );
      expect(approveEvent.args.owner).to.equal(pCvx.address);
      expect(approveEvent.args.spender).to.equal(spCvxInstance.address);
      expect(approveEvent.args.value).to.equal(amount);
      expect(stakeEvent.eventSignature).to.equal(
        'Stake(uint8,address,uint256,uint8,address)'
      );
      expect(stakeEvent.args.rounds).to.equal(rounds);
      expect(stakeEvent.args.to).to.equal(to);
      expect(stakeEvent.args.amount).to.equal(amount);
      expect(stakeEvent.args.f).to.equal(f);
      expect(stakeEvent.args.vault).to.equal(spCvxInstance.address);
      expect(mintFuturesEvent.eventSignature).to.equal(
        'MintFutures(uint8,address,uint256,uint8)'
      );
      expect(mintFuturesEvent.args.rounds).to.equal(rounds);
      expect(mintFuturesEvent.args.to).to.equal(to);
      expect(mintFuturesEvent.args.amount).to.equal(amount);
      expect(mintFuturesEvent.args.f).to.equal(f);
      expect(rpCvxBalances.length).to.equal(rounds);
      expect(every(rpCvxBalances, (r) => r.eq(amount))).to.equal(true);
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

    it('Should revert if shares balance is insufficient', async () => {
      const spCvx = await pCvx.getSpCvx();
      const vault = spCvx[spCvx.length - 1];
      const to = admin.address;
      const spCvxInstance = await getSpCvx(vault);
      const spCvxBalance = await spCvxInstance.balanceOf(admin.address);
      const invalidAmount = spCvxBalance.add(1);

      await spCvxInstance.increaseAllowance(pCvx.address, invalidAmount);

      await expect(pCvx.unstake(vault, to, invalidAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      );
    });

    it('Should revert if before stake expiry', async () => {
      const spCvx = await pCvx.getSpCvx();
      const vault = await getSpCvx(spCvx[spCvx.length - 1]);
      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);

      await vault.increaseAllowance(pCvx.address, amount);

      await expect(pCvx.unstake(vault.address, to, amount)).to.be.revertedWith(
        'BeforeStakeExpiry()'
      );
    });

    it('Should unstake pCVX', async () => {
      const spCvx = await pCvx.getSpCvx();
      const vault = await getSpCvx(spCvx[spCvx.length - 1]);
      const stakeExpiry = await vault.stakeExpiry();
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(Number(stakeExpiry.sub(timestamp)));

      const to = admin.address;
      const amount = await vault.balanceOf(admin.address);
      const pCvxBalanceBefore = await pCvx.balanceOf(to);
      const vaultShareBalanceBefore = await vault.balanceOf(admin.address);

      // Expected pCVX balance post-unstake
      const expectedPCvxBalance = pCvxBalanceBefore.add(amount);
      const expectedShareBalance = vaultShareBalanceBefore.sub(amount);

      await vault.increaseAllowance(pCvx.address, amount);

      const events = await callAndReturnEvents(pCvx.unstake, [
        vault.address,
        to,
        amount,
      ]);
      const unstakeEvent = events[0];
      const transferEvent = events[2];
      const pCvxBalanceAfter = await pCvx.balanceOf(to);
      const vaultShareBalanceAfter = await vault.balanceOf(admin.address);

      expect(expectedPCvxBalance).to.equal(pCvxBalanceAfter);
      expect(expectedPCvxBalance).to.not.equal(0);
      expect(expectedShareBalance).to.equal(vaultShareBalanceAfter);
      expect(expectedShareBalance).to.equal(0);
      expect(unstakeEvent.eventSignature).to.equal(
        'Unstake(address,address,uint256)'
      );
      expect(unstakeEvent.args.vault).to.equal(vault.address);
      expect(unstakeEvent.args.to).to.equal(to);
      expect(unstakeEvent.args.amount).to.equal(amount);
      expect(transferEvent.eventSignature).to.equal(
        'Transfer(address,address,uint256)'
      );
      expect(transferEvent.args.from).to.equal(admin.address);
      expect(transferEvent.args.to).to.equal(pCvx.address);
      expect(transferEvent.args.value).to.equal(amount);
    });
  });

  describe('performEpochMaintenance', () => {
    before(async () => {
      const crvRewardAmount = toBN(5e18);
      const cvxCrvRewardAmount = toBN(10e18);

      await crv.approve(cvxLocker.address, crvRewardAmount);
      await cvxCrvToken.approve(cvxLocker.address, cvxCrvRewardAmount);
      await cvxLocker.notifyRewardAmount(crv.address, crvRewardAmount);
      await cvxLocker.notifyRewardAmount(
        cvxCrvToken.address,
        cvxCrvRewardAmount
      );

      // Increase time to accrue rewards
      await increaseBlockTimestamp(10000);
    });

    it('Should not allow claimVotiumReward to be called if maintenance has not been performed', async () => {
      const { snapshotId } = await pCvx.getEpoch(await pCvx.getCurrentEpoch());
      const token = cvx.address;
      const index = 0;
      const amount = toBN(1e18);
      const proof = new BalanceTree([
        { amount, account: admin.address },
      ]).getProof(index, admin.address, amount);

      expect(snapshotId).to.equal(0);
      await expect(
        pCvx.claimVotiumReward(token, index, amount, proof)
      ).to.be.revertedWith('MaintenanceRequired()');
    });

    it('Should take a snapshot and claim misc. rewards', async () => {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const epochBefore = await pCvx.getEpoch(currentEpoch);
      const snapshotIdBefore = await pCvx.getCurrentSnapshotId();
      const cvxCrvBalanceBefore = await cvxCrvToken.balanceOf(pCvx.address);
      const crvBalanceBefore = await crv.balanceOf(pCvx.address);
      const treasuryCrvBalanceBefore = await crv.balanceOf(treasury.address);
      const revenueLockersCrvBalanceBefore = await crv.balanceOf(
        revenueLockers.address
      );
      const contributorsCrvBalanceBefore = await crv.balanceOf(
        contributors.address
      );
      const treasuryCvxCrvBalanceBefore = await cvxCrvToken.balanceOf(
        treasury.address
      );
      const revenueLockersCvxCrvBalanceBefore = await cvxCrvToken.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxCrvBalanceBefore = await cvxCrvToken.balanceOf(
        contributors.address
      );
      const [claimableCrv, claimableCvxCrv] = await cvxLocker.claimableRewards(
        pCvx.address
      );
      const rewardFeePercent = await pCvx.fees(feesEnum.reward);
      const FEE_DENOMINATOR = await pCvx.FEE_DENOMINATOR();
      const crvRewardFee = claimableCrv.amount
        .mul(rewardFeePercent)
        .div(FEE_DENOMINATOR);
      const cvxCrvRewardFee = claimableCvxCrv.amount
        .mul(rewardFeePercent)
        .div(FEE_DENOMINATOR);
      const events = await callAndReturnEvents(
        pCvx.performEpochMaintenance,
        []
      );
      const snapshotEvent = events[0];
      const performEvent = events[1];
      const epochAfter = await pCvx.getEpoch(currentEpoch);
      const snapshotIdAfter = await pCvx.getCurrentSnapshotId();
      const cvxCrvBalanceAfter = await cvxCrvToken.balanceOf(pCvx.address);
      const crvBalanceAfter = await crv.balanceOf(pCvx.address);
      const treasuryCrvBalanceAfter = await crv.balanceOf(treasury.address);
      const revenueLockersCrvBalanceAfter = await crv.balanceOf(
        revenueLockers.address
      );
      const contributorsCrvBalanceAfter = await crv.balanceOf(
        contributors.address
      );
      const treasuryCvxCrvBalanceAfter = await cvxCrvToken.balanceOf(
        treasury.address
      );
      const revenueLockersCvxCrvBalanceAfter = await cvxCrvToken.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxCrvBalanceAfter = await cvxCrvToken.balanceOf(
        contributors.address
      );
      const treasuryPercent = await pirexFees.treasuryPercent();
      const revenueLockersPercent = await pirexFees.revenueLockersPercent();
      const contributorsPercent = await pirexFees.contributorsPercent();
      const PERCENT_DENOMINATOR = await pirexFees.PERCENT_DENOMINATOR();
      const expectedTreasuryCrvFees = crvRewardFee
        .mul(treasuryPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedRevenueLockersCrvFees = crvRewardFee
        .mul(revenueLockersPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedContributorsCrvFees = crvRewardFee
        .mul(contributorsPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedTreasuryCvxCrvFees = cvxCrvRewardFee
        .mul(treasuryPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedRevenueLockersCvxCrvFees = cvxCrvRewardFee
        .mul(revenueLockersPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedContributorsCvxCrvFees = cvxCrvRewardFee
        .mul(contributorsPercent)
        .div(PERCENT_DENOMINATOR);

      expect(epochBefore.snapshotId).to.equal(0);
      expect(epochBefore.rewards.length).to.equal(0);
      expect(epochBefore.snapshotRewards.length).to.equal(0);
      expect(epochBefore.futuresRewards.length).to.equal(0);
      expect(epochAfter.snapshotId).to.equal(snapshotIdAfter);
      expect(epochAfter.rewards.length).to.equal(2);
      expect(epochAfter.snapshotRewards.length).to.equal(2);
      expect(epochAfter.futuresRewards.length).to.equal(2);
      expect(snapshotIdAfter).to.not.equal(snapshotIdBefore);
      expect(snapshotIdAfter).to.equal(snapshotIdBefore.add(1));

      // Due to rewards accruing, it doesn't seem possible to get the exact figures,
      // unless there are no more rewards to issue
      expect(crvBalanceAfter.gt(crvBalanceBefore)).to.be.equal(true);
      expect(cvxCrvBalanceAfter.gt(cvxCrvBalanceBefore)).to.be.equal(true);
      expect(
        crvBalanceAfter.gte(
          crvBalanceBefore.add(claimableCrv.amount.sub(crvRewardFee))
        )
      ).to.equal(true);
      expect(
        cvxCrvBalanceAfter.gte(
          cvxCrvBalanceBefore.add(claimableCvxCrv.amount.sub(cvxCrvRewardFee))
        )
      ).to.be.equal(true);
      expect(treasuryCrvBalanceAfter).to.not.equal(treasuryCrvBalanceBefore);
      expect(
        treasuryCrvBalanceAfter.gt(
          treasuryCrvBalanceBefore.add(expectedTreasuryCrvFees)
        )
      ).to.be.equal(true);
      expect(
        treasuryCrvBalanceAfter.lt(
          treasuryCrvBalanceBefore
            .add(expectedTreasuryCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(revenueLockersCrvBalanceAfter).to.not.equal(
        revenueLockersCrvBalanceBefore
      );
      expect(
        revenueLockersCrvBalanceAfter.gt(
          revenueLockersCrvBalanceBefore.add(expectedRevenueLockersCrvFees)
        )
      ).to.equal(true);
      expect(
        revenueLockersCrvBalanceAfter.lt(
          revenueLockersCrvBalanceBefore
            .add(expectedRevenueLockersCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(contributorsCrvBalanceAfter).to.not.equal(
        contributorsCrvBalanceBefore
      );
      expect(
        contributorsCrvBalanceAfter.gt(
          contributorsCrvBalanceBefore.add(expectedContributorsCrvFees)
        )
      ).to.equal(true);
      expect(
        contributorsCrvBalanceAfter.lt(
          contributorsCrvBalanceBefore
            .add(expectedContributorsCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(treasuryCvxCrvBalanceAfter).to.not.equal(
        treasuryCvxCrvBalanceBefore
      );
      expect(
        treasuryCvxCrvBalanceAfter.gt(
          treasuryCvxCrvBalanceBefore.add(expectedTreasuryCvxCrvFees)
        )
      ).to.equal(true);
      expect(
        treasuryCvxCrvBalanceAfter.lt(
          treasuryCvxCrvBalanceBefore
            .add(expectedTreasuryCvxCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(revenueLockersCvxCrvBalanceAfter).to.not.equal(
        revenueLockersCvxCrvBalanceBefore
      );
      expect(
        revenueLockersCvxCrvBalanceAfter.gt(
          revenueLockersCvxCrvBalanceBefore.add(
            expectedRevenueLockersCvxCrvFees
          )
        )
      ).to.equal(true);
      expect(
        revenueLockersCvxCrvBalanceAfter.lt(
          revenueLockersCvxCrvBalanceBefore
            .add(expectedRevenueLockersCvxCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(contributorsCvxCrvBalanceAfter).to.not.equal(
        contributorsCvxCrvBalanceBefore
      );
      expect(
        contributorsCvxCrvBalanceAfter.gt(
          contributorsCvxCrvBalanceBefore.add(expectedContributorsCvxCrvFees)
        )
      ).to.equal(true);
      expect(
        contributorsCvxCrvBalanceAfter.lt(
          contributorsCvxCrvBalanceBefore
            .add(expectedContributorsCvxCrvFees)
            .mul(101)
            .div(100)
        )
      ).to.equal(true);
      expect(snapshotEvent.eventSignature).to.equal('Snapshot(uint256)');
      expect(snapshotEvent.args.id).to.equal(snapshotIdAfter);
      expect(performEvent.eventSignature).to.equal(
        'PerformEpochMaintenance(uint256,uint256)'
      );
      expect(performEvent.args.epoch).to.equal(currentEpoch);
      expect(performEvent.args.snapshotId).to.equal(snapshotIdAfter);
    });
  });

  describe('claimVotiumReward', () => {
    let cvxRewardDistribution: { account: string; amount: BigNumber }[];
    let crvRewardDistribution: { account: string; amount: BigNumber }[];
    let cvxTree: BalanceTree;
    let crvTree: BalanceTree;

    before(async () => {
      cvxRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(1e18),
        },
      ];
      crvRewardDistribution = [
        {
          account: pCvx.address,
          amount: toBN(2e18),
        },
      ];
      cvxTree = new BalanceTree(cvxRewardDistribution);
      crvTree = new BalanceTree(crvRewardDistribution);

      const token1 = cvx.address;
      const token2 = crv.address;

      await cvx.transfer(votiumMultiMerkleStash.address, toBN(1e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        token1,
        cvxTree.getHexRoot()
      );

      await crv.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        token2,
        crvTree.getHexRoot()
      );
    });

    it('Should revert if token is zero address', async () => {
      const invalidToken = zeroAddress;
      const index = 0;
      const account = pCvx.address;
      const amount = cvxRewardDistribution[0].amount;
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(invalidToken, index, amount, proof)
      ).to.be.revertedWith(
        'Transaction reverted: function returned an unexpected amount of data'
      );
    });

    it('Should revert if index is invalid', async () => {
      const token = cvx.address;
      const invalidIndex = 10;
      const index = 0; // Used to generate a valid proof
      const account = pCvx.address;
      const amount = cvxRewardDistribution[0].amount;
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(token, invalidIndex, amount, proof)
      ).to.be.revertedWith(
        `VM Exception while processing transaction: reverted with reason string 'Invalid proof.'`
      );
    });

    it('Should revert if amount is zero', async () => {
      const token = cvx.address;
      const index = 0;
      const account = pCvx.address;
      const invalidAmount = toBN(100e18);
      const amount = cvxRewardDistribution[0].amount; // Used to generate a valid proof
      const proof = cvxTree.getProof(index, account, amount);

      await expect(
        pCvx.claimVotiumReward(token, index, invalidAmount, proof)
      ).to.be.revertedWith(
        `VM Exception while processing transaction: reverted with reason string 'Invalid proof.'`
      );
    });

    it('Should claim Votium rewards and set distribution for pCVX and rpCVX token holders', async () => {
      const tokens = [cvx.address, crv.address];
      const index = 0;
      const account = pCvx.address;
      const amounts = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const trees = [
        cvxTree.getProof(index, account, amounts[0]),
        crvTree.getProof(index, account, amounts[1]),
      ];
      const snapshotSupply = await pCvx.totalSupply();
      const currentEpoch = await pCvx.getCurrentEpoch();
      const epochRpCvxSupply = await (
        await getRpCvx(await pCvx.rpCvx())
      ).totalSupply(currentEpoch);
      const rewardFee = await pCvx.fees(feesEnum.reward);
      const FEE_DENOMINATOR = await pCvx.FEE_DENOMINATOR();
      const cvxFee = amounts[0].mul(rewardFee).div(FEE_DENOMINATOR);
      const crvFee = amounts[1].mul(rewardFee).div(FEE_DENOMINATOR);
      const treasuryCvxBalanceBefore = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceBefore = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceBefore = await cvx.balanceOf(
        contributors.address
      );
      const treasuryCrvBalanceBefore = await crv.balanceOf(treasury.address);
      const revenueLockersCrvBalanceBefore = await crv.balanceOf(
        revenueLockers.address
      );
      const contributorsCrvBalanceBefore = await crv.balanceOf(
        contributors.address
      );
      const cvxClaimEvents = await callAndReturnEvents(pCvx.claimVotiumReward, [
        tokens[0],
        index,
        amounts[0],
        trees[0],
      ]);
      const crvClaimEvents = await callAndReturnEvents(pCvx.claimVotiumReward, [
        tokens[1],
        index,
        amounts[1],
        trees[1],
      ]);
      const cvxClaimEvent = cvxClaimEvents[0];
      const crvClaimEvent = crvClaimEvents[0];
      const epoch = await pCvx.getEpoch(currentEpoch);
      const currentSnapshotId = await pCvx.getCurrentSnapshotId();
      const { snapshotRewards, futuresRewards } = await pCvx.getEpoch(
        currentEpoch
      );
      const votiumSnapshotRewards = snapshotRewards.slice(2);
      const votiumFuturesRewards = futuresRewards.slice(2);
      const expectedVotiumSnapshotRewards = {
        amounts: amounts.map((amount: BigNumber) => {
          const rewards = amount
            .mul(toBN(FEE_DENOMINATOR).sub(rewardFee))
            .div(FEE_DENOMINATOR);

          return rewards
            .mul(snapshotSupply)
            .div(snapshotSupply.add(epochRpCvxSupply));
        }),
      };
      const expectedVotiumFuturesRewards = {
        amounts: amounts.map((amount: BigNumber, idx: number) => {
          const rewards = amount
            .mul(toBN(FEE_DENOMINATOR).sub(rewardFee))
            .div(FEE_DENOMINATOR);

          return rewards.sub(expectedVotiumSnapshotRewards.amounts[idx]);
        }),
      };
      const treasuryCvxBalanceAfter = await cvx.balanceOf(treasury.address);
      const revenueLockersCvxBalanceAfter = await cvx.balanceOf(
        revenueLockers.address
      );
      const contributorsCvxBalanceAfter = await cvx.balanceOf(
        contributors.address
      );
      const treasuryCrvBalanceAfter = await crv.balanceOf(treasury.address);
      const revenueLockersCrvBalanceAfter = await crv.balanceOf(
        revenueLockers.address
      );
      const contributorsCrvBalanceAfter = await crv.balanceOf(
        contributors.address
      );
      const treasuryPercent = await pirexFees.treasuryPercent();
      const revenueLockersPercent = await pirexFees.revenueLockersPercent();
      const contributorsPercent = await pirexFees.contributorsPercent();
      const PERCENT_DENOMINATOR = await pirexFees.PERCENT_DENOMINATOR();
      const expectedTreasuryCvxFees = cvxFee
        .mul(treasuryPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedRevenueLockersCvxFees = cvxFee
        .mul(revenueLockersPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedContributorsCvxFees = cvxFee
        .mul(contributorsPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedTreasuryCrvFees = crvFee
        .mul(treasuryPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedRevenueLockersCrvFees = crvFee
        .mul(revenueLockersPercent)
        .div(PERCENT_DENOMINATOR);
      const expectedContributorsCrvFees = crvFee
        .mul(contributorsPercent)
        .div(PERCENT_DENOMINATOR);

      expect(epoch.rewards.includes(tokens[0])).to.equal(true);
      expect(epoch.rewards.includes(tokens[1])).to.equal(true);
      expect(votiumSnapshotRewards).to.deep.equal(
        expectedVotiumSnapshotRewards.amounts
      );
      expect(votiumFuturesRewards).to.deep.equal(
        expectedVotiumFuturesRewards.amounts
      );
      expect(treasuryCvxBalanceAfter).to.not.equal(treasuryCvxBalanceBefore);
      expect(treasuryCvxBalanceAfter).to.equal(
        treasuryCvxBalanceBefore.add(expectedTreasuryCvxFees)
      );
      expect(revenueLockersCvxBalanceAfter).to.not.equal(
        revenueLockersCvxBalanceBefore
      );
      expect(revenueLockersCvxBalanceAfter).to.equal(
        revenueLockersCvxBalanceBefore.add(expectedRevenueLockersCvxFees)
      );
      expect(contributorsCvxBalanceAfter).to.not.equal(
        contributorsCvxBalanceBefore
      );
      expect(contributorsCvxBalanceAfter).to.equal(
        contributorsCvxBalanceBefore.add(expectedContributorsCvxFees)
      );
      expect(treasuryCrvBalanceAfter).to.not.equal(treasuryCrvBalanceBefore);
      expect(treasuryCrvBalanceAfter).to.equal(
        treasuryCrvBalanceBefore.add(expectedTreasuryCrvFees)
      );
      expect(revenueLockersCrvBalanceAfter).to.not.equal(
        revenueLockersCrvBalanceBefore
      );
      expect(revenueLockersCrvBalanceAfter).to.equal(
        revenueLockersCrvBalanceBefore.add(expectedRevenueLockersCrvFees)
      );
      expect(contributorsCrvBalanceAfter).to.not.equal(
        contributorsCrvBalanceBefore
      );
      expect(contributorsCrvBalanceAfter).to.equal(
        contributorsCrvBalanceBefore.add(expectedContributorsCrvFees)
      );
      expect(cvxClaimEvent.eventSignature).to.equal(
        'ClaimVotiumReward(address,uint256,uint256,uint256)'
      );
      expect(cvxClaimEvent.args.token).to.equal(tokens[0]);
      expect(cvxClaimEvent.args.index).to.equal(index);
      expect(cvxClaimEvent.args.amount).to.equal(amounts[0]);
      expect(cvxClaimEvent.args.snapshotId).to.equal(currentSnapshotId);

      expect(crvClaimEvent.eventSignature).to.equal(
        'ClaimVotiumReward(address,uint256,uint256,uint256)'
      );
      expect(crvClaimEvent.args.token).to.equal(tokens[1]);
      expect(crvClaimEvent.args.index).to.equal(index);
      expect(crvClaimEvent.args.amount).to.equal(amounts[1]);
      expect(crvClaimEvent.args.snapshotId).to.equal(currentSnapshotId);
    });
  });

  describe('claimSnapshotReward', () => {
    it('Should revert if epoch is zero', async () => {
      const invalidEpoch = 0;
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.claimSnapshotReward(invalidEpoch, rewardIndex, to)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if rewardIndex is invalid', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidRewardIndex = 5;
      const to = admin.address;

      await expect(
        pCvx.claimSnapshotReward(epoch, invalidRewardIndex, to)
      ).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x32 (Array accessed at an out-of-bounds or negative index)'
      );
    });

    it('Should revert if to is zero address', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const invalidTo = zeroAddress;

      await expect(
        pCvx.claimSnapshotReward(epoch, rewardIndex, invalidTo)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should revert if msg.sender has an insufficient balance', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).claimSnapshotReward(epoch, rewardIndex, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('Should claim snapshot reward', async () => {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const cvxCrvBalanceBefore = await cvxCrvToken.balanceOf(admin.address);
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId, snapshotRewards } = await pCvx.getEpoch(currentEpoch);
      const snapshotBalance = await pCvx.balanceOfAt(admin.address, snapshotId);
      const snapshotSupply = await pCvx.totalSupplyAt(snapshotId);
      const to = admin.address;
      const crvEvents1 = await callAndReturnEvents(pCvx.claimSnapshotReward, [
        currentEpoch,
        0,
        to,
      ]);
      const cvxCrvEvents = await callAndReturnEvents(pCvx.claimSnapshotReward, [
        currentEpoch,
        1,
        to,
      ]);
      const cvxEvents = await callAndReturnEvents(pCvx.claimSnapshotReward, [
        currentEpoch,
        2,
        to,
      ]);
      const crvEvents2 = await callAndReturnEvents(pCvx.claimSnapshotReward, [
        currentEpoch,
        3,
        to,
      ]);
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const cvxCrvBalanceAfter = await cvxCrvToken.balanceOf(admin.address);
      const expectedCrvRewards = snapshotRewards[0]
        .mul(snapshotBalance)
        .div(snapshotSupply)
        .add(snapshotRewards[3].mul(snapshotBalance).div(snapshotSupply));
      const expectedCvxCrvRewards = snapshotRewards[1]
        .mul(snapshotBalance)
        .div(snapshotSupply);
      const expectedCvxRewards = snapshotRewards[2]
        .mul(snapshotBalance)
        .div(snapshotSupply);

      expect(crvEvents1[0].eventSignature)
        .to.equal(cvxCrvEvents[0].eventSignature)
        .to.equal(cvxEvents[0].eventSignature)
        .to.equal(crvEvents2[0].eventSignature)
        .to.equal(
          'ClaimSnapshotReward(uint256,uint256,address,uint256,uint256,address,uint256)'
        );
      expect(crvEvents1[0].args.epoch)
        .to.equal(cvxCrvEvents[0].args.epoch)
        .to.equal(cvxEvents[0].args.epoch)
        .to.equal(crvEvents2[0].args.epoch)
        .to.equal(currentEpoch);
      expect(crvEvents1[0].args.to)
        .to.equal(cvxCrvEvents[0].args.to)
        .to.equal(cvxEvents[0].args.to)
        .to.equal(crvEvents2[0].args.to)
        .to.equal(admin.address);
      expect(crvEvents1[0].args.snapshotId)
        .to.equal(cvxCrvEvents[0].args.snapshotId)
        .to.equal(cvxEvents[0].args.snapshotId)
        .to.equal(crvEvents2[0].args.snapshotId)
        .to.equal(snapshotId);
      expect(crvEvents1[0].args.snapshotBalance)
        .to.equal(cvxCrvEvents[0].args.snapshotBalance)
        .to.equal(cvxEvents[0].args.snapshotBalance)
        .to.equal(crvEvents2[0].args.snapshotBalance)
        .to.equal(snapshotBalance);
      expect(crvEvents1[0].args.reward).to.equal(crv.address);
      expect(crvEvents2[0].args.reward).to.equal(crv.address);
      expect(cvxEvents[0].args.reward).to.equal(cvx.address);
      expect(cvxCrvEvents[0].args.reward).to.equal(cvxCrvToken.address);
      expect(crvEvents1[0].args.rewardIndex).to.equal(0);
      expect(cvxCrvEvents[0].args.rewardIndex).to.equal(1);
      expect(cvxEvents[0].args.rewardIndex).to.equal(2);
      expect(crvEvents2[0].args.rewardIndex).to.equal(3);
      expect(crvEvents1[0].args.claimAmount).to.equal(
        snapshotRewards[0].mul(snapshotBalance).div(snapshotSupply)
      );
      expect(cvxCrvEvents[0].args.claimAmount).to.equal(
        snapshotRewards[1].mul(snapshotBalance).div(snapshotSupply)
      );
      expect(cvxEvents[0].args.claimAmount).to.equal(
        snapshotRewards[2].mul(snapshotBalance).div(snapshotSupply)
      );
      expect(crvEvents2[0].args.claimAmount).to.equal(
        snapshotRewards[3].mul(snapshotBalance).div(snapshotSupply)
      );
      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(cvxCrvBalanceAfter).to.not.equal(cvxCrvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(expectedCrvRewards)
      );
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      expect(cvxCrvBalanceAfter).to.equal(
        cvxCrvBalanceBefore.add(expectedCvxCrvRewards)
      );
    });

    it('Should revert if msg.sender has already claimed', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const rewardIndex = 0;
      const to = admin.address;

      await expect(
        pCvx.claimSnapshotReward(epoch, rewardIndex, to)
      ).to.be.revertedWith('AlreadyClaimed()');
    });
  });

  describe('claimFuturesRewards', () => {
    it('Should revert if epoch is zero', async () => {
      const invalidEpoch = 0;
      const to = admin.address;

      await expect(
        pCvx.claimFuturesRewards(invalidEpoch, to)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if to is zero address', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const invalidTo = zeroAddress;
      const rpCvx = await getRpCvx(await pCvx.rpCvx());

      await rpCvx.setApprovalForAll(pCvx.address, true);

      await expect(
        pCvx.claimFuturesRewards(epoch, invalidTo)
      ).to.be.revertedWith('ERC20: transfer to the zero address');
    });

    it('Should revert if msg.sender has an insufficient balance', async () => {
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;

      await expect(
        pCvx.connect(notAdmin).claimFuturesRewards(epoch, to)
      ).to.be.revertedWith('InsufficientBalance()');
    });

    it('Should claim futures reward', async () => {
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const crvBalanceBefore = await crv.balanceOf(admin.address);
      const cvxCrvBalanceBefore = await cvxCrvToken.balanceOf(admin.address);
      const epoch = await pCvx.getCurrentEpoch();
      const to = admin.address;
      const rpCvx = await ethers.getContractAt(
        'ERC1155PresetMinterSupply',
        await pCvx.rpCvx()
      );

      // Transfer half to test correctness for partial reward claims
      await rpCvx.safeTransferFrom(
        admin.address,
        notAdmin.address,
        epoch,
        (await rpCvx.balanceOf(admin.address, epoch)).div(2),
        ethers.utils.formatBytes32String('')
      );

      const rpCvxBalanceBefore = await rpCvx.balanceOf(admin.address, epoch);
      const rpCvxSupplyBefore = await rpCvx.totalSupply(epoch);

      await rpCvx.setApprovalForAll(pCvx.address, true);

      const events = await callAndReturnEvents(pCvx.claimFuturesRewards, [
        epoch,
        to,
      ]);
      const claimEvent = events[0];
      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const crvBalanceAfter = await crv.balanceOf(admin.address);
      const cvxCrvBalanceAfter = await cvxCrvToken.balanceOf(admin.address);
      const rpCvxBalanceAfter = await rpCvx.balanceOf(admin.address, epoch);
      const rpCvxSupplyAfter = await rpCvx.totalSupply(epoch);
      const { rewards, futuresRewards } = await pCvx.getEpoch(epoch);
      const expectedClaimAmounts = futuresRewards.map((amount: BigNumber) =>
        amount.mul(rpCvxBalanceBefore).div(rpCvxSupplyBefore)
      );

      expect(rpCvxBalanceAfter).to.not.equal(rpCvxBalanceBefore);
      expect(rpCvxBalanceAfter).to.equal(0);
      expect(rpCvxSupplyAfter).to.not.equal(rpCvxSupplyBefore);
      expect(rpCvxSupplyAfter).to.equal(
        rpCvxSupplyBefore.sub(rpCvxBalanceBefore)
      );
      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedClaimAmounts[2])
      );
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore
          .add(expectedClaimAmounts[0])
          .add(expectedClaimAmounts[3])
      );
      expect(cvxCrvBalanceAfter).to.not.equal(cvxCrvBalanceBefore);
      expect(cvxCrvBalanceAfter).to.equal(
        cvxCrvBalanceBefore.add(expectedClaimAmounts[1])
      );
      expect(claimEvent.eventSignature).to.equal(
        'ClaimFuturesRewards(uint256,address,address[])'
      );
      expect(claimEvent.args.epoch).to.equal(epoch);
      expect(claimEvent.args.to).to.equal(to);
      expect(claimEvent.args.rewards).to.deep.equal(rewards);
    });
  });

  describe('exchangeFutures', () => {
    before(async () => {
      const depositAmount = toBN(1e18);
      const stakeRounds = 1;

      await cvx.approve(pCvx.address, depositAmount);
      await pCvx.deposit(admin.address, depositAmount);
      await pCvx.stake(
        stakeRounds,
        admin.address,
        depositAmount,
        futuresEnum.reward
      );
    });

    it('Should revert if epoch is current', async () => {
      const invalidEpoch1 = await pCvx.getCurrentEpoch();
      const invalidEpoch2 = invalidEpoch1.sub(epochDuration);
      const to = admin.address;
      const amount = toBN(1e18);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(invalidEpoch1, to, amount, i, o)
      ).to.be.revertedWith('PastExchangePeriod()');
      await expect(
        pCvx.exchangeFutures(invalidEpoch2, to, amount, i, o)
      ).to.be.revertedWith('PastExchangePeriod()');
    });

    it('Should revert if amount is zero', async () => {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const to = admin.address;
      const invalidAmount = 0;
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(epoch, to, invalidAmount, i, o)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if sender balance is insufficient', async () => {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await getRpCvx(await pCvx.rpCvx());
      const sender = notAdmin.address;
      const rpCvxBalance = await rpCvx.balanceOf(sender, epoch);
      const to = admin.address;
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await rpCvx.connect(notAdmin).setApprovalForAll(pCvx.address, true);

      expect(rpCvxBalance.lt(amount)).to.equal(true);
      await expect(
        pCvx.connect(notAdmin).exchangeFutures(epoch, to, amount, i, o)
      ).to.be.revertedWith('ERC1155: burn amount exceeds balance');
    });

    it('Should revert if to is zero address', async () => {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const invalidTo = zeroAddress;
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;

      await expect(
        pCvx.exchangeFutures(epoch, invalidTo, amount, i, o)
      ).to.be.revertedWith('ERC1155: mint to the zero address');
    });

    it('Should exchange rewards futures for vote futures', async () => {
      const epoch = (await pCvx.getCurrentEpoch()).add(epochDuration);
      const rpCvx = await getRpCvx(await pCvx.rpCvx());
      const vpCvx = await getVpCvx(await pCvx.vpCvx());
      const sender = admin.address;
      const to = admin.address;
      const rpCvxBalanceBefore = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceBefore = await vpCvx.balanceOf(to, epoch);
      const amount = toBN(1);
      const i = futuresEnum.reward;
      const o = futuresEnum.vote;
      const events = await callAndReturnEvents(pCvx.exchangeFutures, [
        epoch,
        to,
        amount,
        i,
        o,
      ]);
      const exchangeEvent = events[0];
      const rpCvxBalanceAfter = await rpCvx.balanceOf(sender, epoch);
      const vpCvxBalanceAfter = await vpCvx.balanceOf(to, epoch);

      expect(rpCvxBalanceAfter).to.equal(rpCvxBalanceBefore.sub(amount));
      expect(vpCvxBalanceAfter).to.equal(vpCvxBalanceBefore.add(amount));
      expect(exchangeEvent.eventSignature).to.equal(
        'ExchangeFutures(uint256,address,uint256,uint8,uint8)'
      );
      expect(exchangeEvent.args.epoch).to.equal(epoch);
      expect(exchangeEvent.args.to).to.equal(to);
      expect(exchangeEvent.args.amount).to.equal(amount);
      expect(exchangeEvent.args.i).to.equal(i);
      expect(exchangeEvent.args.o).to.equal(o);
    });
  });
});
