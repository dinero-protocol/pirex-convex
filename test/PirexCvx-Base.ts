import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  callAndReturnEvents,
  increaseBlockTimestamp,
  parseLog,
  toBN,
  validateEvent,
} from './helpers';
import {
  ConvexToken,
  CvxLockerV2,
  DelegateRegistry,
  PxCvx,
  PirexCvx,
  MultiMerkleStash,
  PirexFees,
  CvxRewardPool,
  UnionPirexVault,
} from '../typechain-types';
import { BigNumber } from 'ethers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Base', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let unionPirex: UnionPirexVault;
  let cvx: ConvexToken;
  let cvxCrvToken: any;
  let cvxLocker: CvxLockerV2;
  let cvxDelegateRegistry: DelegateRegistry;
  let cvxRewardPool: CvxRewardPool;
  let votiumMultiMerkleStash: MultiMerkleStash;

  let zeroAddress: string;
  let epochDuration: BigNumber;

  let delegationSpace: string;
  let delegationSpaceBytes32: string;
  let contractEnum: any;
  let convexContractEnum: any;
  let feesEnum: any;

  const { MaxUint256: uint256Max } = ethers.constants;

  before(async function () {
    ({
      admin,
      notAdmin,
      cvx,
      cvxCrvToken,
      cvxLocker,
      cvxRewardPool,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      pirexFees,
      pxCvx,
      pCvx,
      unionPirex,
      zeroAddress,
      epochDuration,
      delegationSpace,
      delegationSpaceBytes32,
      contractEnum,
      convexContractEnum,
      feesEnum,
    } = this);
  });

  describe('initial state', function () {
    it('Should have predefined state variables', async function () {
      const EPOCH_DURATION = await pCvx.EPOCH_DURATION();
      const FEE_DENOMINATOR = await pCvx.FEE_DENOMINATOR();
      const MAX_REDEMPTION_TIME = await pCvx.MAX_REDEMPTION_TIME();
      const _delegationSpace = await pCvx.delegationSpace();

      expect(EPOCH_DURATION).to.equal(1209600);
      expect(FEE_DENOMINATOR).to.equal(1000000);
      expect(MAX_REDEMPTION_TIME).to.equal(10281600);
      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const { snapshotId } = await pxCvx.getEpoch(await pCvx.getCurrentEpoch());
      const _CVX = await pCvx.CVX();
      const _cvxLocker = await pCvx.cvxLocker();
      const _cvxDelegateRegistry = await pCvx.cvxDelegateRegistry();
      const _cvxRewardPool = await pCvx.cvxRewardPool();
      const _cvxCRV = await pCvx.cvxCRV();
      const _pirexFees = await pCvx.pirexFees();
      const _votiumMultiMerkleStash = await pCvx.votiumMultiMerkleStash();
      const upCvx = await pCvx.upCvx();
      const vpCvx = await pCvx.vpCvx();
      const rpCvx = await pCvx.rpCvx();
      const spCvx = await pCvx.spCvx();
      const _name = await pxCvx.name();
      const _symbol = await pxCvx.symbol();
      const paused = await pCvx.paused();

      expect(snapshotId).to.equal(0);
      expect(_CVX).to.equal(cvx.address);
      expect(_CVX).to.not.equal(zeroAddress);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvxLocker).to.not.equal(zeroAddress);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry.address);
      expect(_cvxDelegateRegistry).to.not.equal(zeroAddress);
      expect(_cvxRewardPool).to.equal(cvxRewardPool.address);
      expect(_cvxCRV).to.equal(cvxCrvToken.address);
      expect(_pirexFees).to.equal(pirexFees.address);
      expect(_pirexFees).to.not.equal(zeroAddress);
      expect(_votiumMultiMerkleStash).to.equal(votiumMultiMerkleStash.address);
      expect(_votiumMultiMerkleStash).to.not.equal(zeroAddress);
      expect(upCvx).to.not.equal(zeroAddress);
      expect(vpCvx).to.not.equal(zeroAddress);
      expect(rpCvx).to.not.equal(zeroAddress);
      expect(spCvx).to.not.equal(zeroAddress);
      expect(_name).to.equal('Pirex CVX');
      expect(_symbol).to.equal('pxCVX');
      expect(paused).to.be.true;
    });
  });

  describe('setContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const c = contractEnum.pirexFees;
      const invalidContractAddress = zeroAddress;

      await expect(
        pCvx.setContract(c, invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const c = contractEnum.pirexFees;
      const contractAddress = admin.address;

      await expect(
        pCvx.connect(notAdmin).setContract(c, contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set pxCvx', async function () {
      const pxCvxBefore = await pCvx.pxCvx();
      const c = contractEnum.pxCvx;

      // Deplyo a new temporary PxCvx contract for testing purposes
      const newContract = await (
        await ethers.getContractFactory('PxCvx')
      ).deploy();
      await newContract.setOperator(pCvx.address);
      const contractAddress = newContract.address;

      const [setEvent] = await callAndReturnEvents(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const pxCvxAfter = await pCvx.pxCvx();

      await pCvx.setContract(c, pxCvxBefore);

      expect(pxCvxBefore).to.not.equal(pxCvxAfter);
      expect(pxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set pirexFees', async function () {
      const pirexFeesBefore = await pCvx.pirexFees();
      const c = contractEnum.pirexFees;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const pirexFeesAfter = await pCvx.pirexFees();

      await pCvx.setContract(c, pirexFeesBefore);

      expect(pirexFeesBefore).to.not.equal(pirexFeesAfter);
      expect(pirexFeesAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set upCvx', async function () {
      const upCvxBefore = await pCvx.upCvx();
      const c = contractEnum.upCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const upCvxAfter = await pCvx.upCvx();

      await pCvx.setContract(c, upCvxBefore);

      expect(upCvxBefore).to.not.equal(upCvxAfter);
      expect(upCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress: contractAddress,
      });
    });

    it('Should set spCvx', async function () {
      const spCvxBefore = await pCvx.spCvx();
      const c = contractEnum.spCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const spCvxAfter = await pCvx.spCvx();

      await pCvx.setContract(c, spCvxBefore);

      expect(spCvxBefore).to.not.equal(spCvxAfter);
      expect(spCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      expect(spCvxBefore).to.equal(await pCvx.spCvx());
    });

    it('Should set vpCvx', async function () {
      const vpCvxBefore = await pCvx.vpCvx();
      const c = contractEnum.vpCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const vpCvxAfter = await pCvx.vpCvx();

      await pCvx.setContract(c, vpCvxBefore);

      expect(vpCvxBefore).to.not.equal(vpCvxAfter);
      expect(vpCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set rpCvx', async function () {
      const rpCvxBefore = await pCvx.rpCvx();
      const c = contractEnum.rpCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const rpCvxAfter = await pCvx.rpCvx();

      await pCvx.setContract(c, rpCvxBefore);

      expect(rpCvxBefore).to.not.equal(rpCvxAfter);
      expect(rpCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set unionPirex', async function () {
      const unionPirexBefore = await pCvx.unionPirex();
      const c = contractEnum.unionPirex;
      const contractAddress = unionPirex.address;
      const events = await callAndReturnEvents(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const approvalEvent = parseLog(pxCvx, events[1]);
      const unionPirexAfter = await pCvx.unionPirex();

      expect(unionPirexBefore).to.not.equal(unionPirexAfter);
      expect(unionPirexAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      validateEvent(approvalEvent, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: contractAddress,
        amount: uint256Max,
      });
    });

    it('Should replace unionPirex', async function () {
      const unionPirexAllowanceBefore = await pxCvx.allowance(pCvx.address, unionPirex.address);
      const adminAllowanceBefore = await pxCvx.allowance(pCvx.address, admin.address);
      const unionPirexBefore = await pCvx.unionPirex();
      const c = contractEnum.unionPirex;
      const contractAddress = admin.address;
      const events = await callAndReturnEvents(pCvx.setContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const approvalEvent1 = parseLog(pxCvx, events[1]);
      const approvalEvent2 = parseLog(pxCvx, events[2]);
      const unionPirexAfter = await pCvx.unionPirex();
      const unionPirexAllowanceAfter = await pxCvx.allowance(pCvx.address, unionPirex.address);
      const adminAllowanceAfter = await pxCvx.allowance(pCvx.address, admin.address);

      expect(unionPirexBefore).to.not.equal(unionPirexAfter);
      expect(unionPirexAfter).to.equal(contractAddress);
      expect(unionPirexAllowanceBefore).to.not.equal(unionPirexAllowanceAfter);
      expect(unionPirexAllowanceBefore).to.equal(uint256Max);
      expect(unionPirexAllowanceAfter).to.equal(0);
      expect(adminAllowanceBefore).to.not.equal(adminAllowanceAfter)
      expect(adminAllowanceBefore).to.equal(0);
      expect(adminAllowanceAfter).to.equal(uint256Max)
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      validateEvent(approvalEvent1, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: unionPirex.address,
        amount: 0,
      });
      validateEvent(approvalEvent2, 'Approval(address,address,uint256)', {
        owner: pCvx.address,
        spender: contractAddress,
        amount: uint256Max,
      });

      // Re-set to unionPirex.address to resume normal testing flow
      await pCvx.setContract(c, unionPirex.address);
    });
  });

  describe('setConvexContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const c = convexContractEnum.cvxLocker;
      const invalidContractAddress = zeroAddress;

      await expect(
        pCvx.setConvexContract(c, invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const c = convexContractEnum.cvxLocker;
      const contractAddress = admin.address;

      await expect(
        pCvx.connect(notAdmin).setConvexContract(c, contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set cvxLocker', async function () {
      const cvxLockerBefore = await pCvx.cvxLocker();
      const c = convexContractEnum.cvxLocker;
      const contractAddress = admin.address;
      const events = await callAndReturnEvents(pCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const cvxLockerAfter = await pCvx.cvxLocker();

      // Revert change to appropriate value for future tests
      await pCvx.setConvexContract(c, cvxLockerBefore);

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set cvxDelegateRegistry', async function () {
      const cvxDelegateRegistryBefore = await pCvx.cvxDelegateRegistry();
      const c = convexContractEnum.cvxDelegateRegistry;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const cvxDelegateRegistryAfter = await pCvx.cvxDelegateRegistry();

      await pCvx.setConvexContract(c, cvxDelegateRegistryBefore);

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set cvxRewardPool', async function () {
      const cvxRewardPoolBefore = await pCvx.cvxRewardPool();
      const c = convexContractEnum.cvxRewardPool;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const cvxRewardPoolAfter = await pCvx.cvxRewardPool();

      await pCvx.setConvexContract(c, cvxRewardPoolBefore);

      expect(cvxRewardPoolBefore).to.not.equal(cvxRewardPoolAfter);
      expect(cvxRewardPoolAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set cvxCrvToken', async function () {
      const cvxCrvTokenBefore = await pCvx.cvxCRV();
      const c = convexContractEnum.cvxCrvToken;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const cvxCrvTokenAfter = await pCvx.cvxCRV();

      await pCvx.setConvexContract(c, cvxCrvTokenBefore);

      expect(cvxCrvTokenBefore).to.not.equal(cvxCrvTokenAfter);
      expect(cvxCrvTokenAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
      expect(cvxCrvTokenBefore).to.equal(await pCvx.cvxCRV());
    });
  });

  describe('queueFee', function () {
    it('Should revert if f is not valid Fees enum', async function () {
      const invalidF = 4;
      const newFee = 1;

      await expect(pCvx.queueFee(invalidF, newFee)).to.be.reverted;
    });

    it('Should revert if newFee is greater than FEE_DENOMINATOR', async function () {
      const f = feesEnum.reward;
      const invalidNewFee = toBN(await pCvx.FEE_DENOMINATOR()).add(1);

      await expect(pCvx.queueFee(f, invalidNewFee)).to.be.reverted;
    });

    it('Should revert if not owner', async function () {
      const f = feesEnum.reward;
      const newFee = 1;

      await expect(
        pCvx.connect(notAdmin).queueFee(f, newFee)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should queue a fee change for Fee.Reward', async function () {
      const f = feesEnum.reward;
      const newFee = toBN(40000);
      const rewardsFeeBefore = await pCvx.fees(f);
      const event = await callAndReturnEvent(pCvx.queueFee, [f, newFee]);
      const rewardsFeeAfter = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);

      // Should not change fee, only queue
      expect(rewardsFeeBefore).to.equal(rewardsFeeAfter);
      expect(queuedFee.newFee).to.equal(newFee);
      validateEvent(event, 'QueueFee(uint8,uint32,uint224)', {
        newFee,
        effectiveAfter: queuedFee.effectiveAfter,
      });
    });

    it('Should queue a fee change for Fee.RedemptionMax', async function () {
      const f = feesEnum.redemptionMax;
      const newFee = toBN(50000);
      const rewardsFeeBefore = await pCvx.fees(f);
      const event = await callAndReturnEvent(pCvx.queueFee, [f, newFee]);
      const rewardsFeeAfter = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);

      // Should not change fee, only queue
      expect(rewardsFeeBefore).to.equal(rewardsFeeAfter);
      expect(queuedFee.newFee).to.equal(newFee);
      validateEvent(event, 'QueueFee(uint8,uint32,uint224)', {
        newFee,
        effectiveAfter: queuedFee.effectiveAfter,
      });
    });

    it('Should queue a fee change for Fee.RedemptionMin', async function () {
      const f = feesEnum.redemptionMin;
      const newFee = toBN(10000);
      const rewardsFeeBefore = await pCvx.fees(f);
      const event = await callAndReturnEvent(pCvx.queueFee, [f, newFee]);
      const rewardsFeeAfter = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);

      // Should not change fee, only queue
      expect(rewardsFeeBefore).to.equal(rewardsFeeAfter);
      expect(queuedFee.newFee).to.equal(newFee);
      validateEvent(event, 'QueueFee(uint8,uint32,uint224)', {
        newFee,
        effectiveAfter: queuedFee.effectiveAfter,
      });
    });
  });

  describe('setFee', function () {
    after(async function () {
      // Unpause only after initial setup is completed on previous steps (setting all token contracts etc.)
      await this.pCvx.setPauseState(false);

      // Take a snapshot after setFee tests since we are forwarding an epoch below
      await pxCvx.takeEpochSnapshot();
    });

    it('Should revert if f is not valid Fees enum', async function () {
      const invalidF = 4;
      const queuedFeeIndex = feesEnum.reward;

      await expect(pCvx.setFee(invalidF, queuedFeeIndex)).to.be.reverted;
    });

    it('Should revert if not owner', async function () {
      const f = feesEnum.reward;

      await expect(pCvx.connect(notAdmin).setFee(f)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('Should revert if before effectiveAfter timestamp', async function () {
      const f = feesEnum.reward;
      const queuedFee = await pCvx.queuedFees(f);
      const { timestamp } = await ethers.provider.getBlock('latest');

      expect(queuedFee.effectiveAfter.gt(timestamp)).to.equal(true);
      await expect(pCvx.setFee(f)).to.be.revertedWith(
        'BeforeEffectiveTimestamp()'
      );
    });

    it('Should set the reward fee', async function () {
      const f = feesEnum.reward;
      const rewardFeeBefore = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);
      const { timestamp } = await ethers.provider.getBlock('latest');

      // Forward time to after effective timestamp
      await increaseBlockTimestamp(
        Number(queuedFee.effectiveAfter.sub(timestamp).add(1))
      );

      const event = await callAndReturnEvent(pCvx.setFee, [f]);
      const rewardFeeAfter = await pCvx.fees(f);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(queuedFee.newFee);
      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee: queuedFee.newFee,
      });
    });

    it('Should set the redemption max fee', async function () {
      const f = feesEnum.redemptionMax;
      const rewardFeeBefore = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(
        Number(queuedFee.effectiveAfter.sub(timestamp).add(1))
      );

      const event = await callAndReturnEvent(pCvx.setFee, [f]);
      const rewardFeeAfter = await pCvx.fees(f);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(queuedFee.newFee);
      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee: queuedFee.newFee,
      });
    });

    it('Should set the redemption min fee', async function () {
      const f = feesEnum.redemptionMin;
      const rewardFeeBefore = await pCvx.fees(f);
      const queuedFee = await pCvx.queuedFees(f);
      const { timestamp } = await ethers.provider.getBlock('latest');

      await increaseBlockTimestamp(
        Number(queuedFee.effectiveAfter.sub(timestamp).add(1))
      );

      const event = await callAndReturnEvent(pCvx.setFee, [f]);
      const rewardFeeAfter = await pCvx.fees(f);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(queuedFee.newFee);
      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee: queuedFee.newFee,
      });
    });
  });

  describe('setDelegationSpace', function () {
    it('Should revert if _delegationSpace is an empty string', async function () {
      const invalidDelegationSpace = '';

      await expect(
        pCvx.setDelegationSpace(invalidDelegationSpace)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should revert if not called by owner', async function () {
      await expect(
        pCvx.connect(notAdmin).setDelegationSpace(delegationSpace)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should update delegationSpace', async function () {
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
      validateEvent(setEvent, 'SetDelegationSpace(string)', {
        _delegationSpace: newDelegationSpace,
      });
    });
  });

  describe('setVoteDelegate', function () {
    it('Should revert if _voteDelegate is zero address', async function () {
      const invalidVoteDelegate = zeroAddress;

      await expect(
        pCvx.setVoteDelegate(invalidVoteDelegate)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const voteDelegate = admin.address;

      await expect(
        pCvx.connect(notAdmin).setVoteDelegate(voteDelegate)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set voteDelegate', async function () {
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
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );

      expect(convexDelegateBefore).to.equal(zeroAddress);
      expect(convexDelegateAfter).to.not.equal(convexDelegateBefore);
      expect(convexDelegateAfter).to.equal(voteDelegate);
      validateEvent(setEvent, 'SetVoteDelegate(address)', {
        voteDelegate,
      });
    });
  });

  describe('clearVoteDelegate', function () {
    it('Should revert if not called by owner', async function () {
      await expect(
        pCvx.connect(notAdmin).clearVoteDelegate()
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should remove voteDelegate', async function () {
      const _delegationSpace = await pCvx.delegationSpace();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );
      const events = await callAndReturnEvents(pCvx.clearVoteDelegate, []);
      const removeEvent = events[0];
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        _delegationSpace
      );

      expect(convexDelegateBefore).to.equal(admin.address);
      expect(convexDelegateAfter).to.not.equal(convexDelegateBefore);
      expect(convexDelegateAfter).to.equal(zeroAddress);
      expect(removeEvent.eventSignature).to.equal('ClearVoteDelegate()');
    });
  });

  describe('getCurrentEpoch', function () {
    it('Should return the current epoch', async function () {
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

  describe('getCurrentSnapshotId', function () {
    it('Should return the current snapshot id', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId } = await pxCvx.getEpoch(currentEpoch);
      const currentSnapshotId = await pxCvx.getCurrentSnapshotId();

      expect(snapshotId).to.equal(2);
      expect(snapshotId).to.equal(currentSnapshotId);
    });
  });

  describe('setPauseState', function () {
    it('Should revert if not called by owner', async function () {
      await expect(
        pCvx.connect(notAdmin).setPauseState(true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should pause the contract', async function () {
      const isPausedBefore = await pCvx.paused();

      await pCvx.setPauseState(true);

      const isPausedAfter = await pCvx.paused();

      expect(isPausedBefore).to.be.false;
      expect(isPausedAfter).to.be.true;
    });

    it('Should unpause the contract', async function () {
      const isPausedBefore = await pCvx.paused();

      await pCvx.setPauseState(false);

      const isPausedAfter = await pCvx.paused();

      expect(isPausedBefore).to.be.true;
      expect(isPausedAfter).to.be.false;
    });
  });
});
