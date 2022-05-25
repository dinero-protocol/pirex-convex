import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  callAndReturnEvents,
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
  UnionPirexVault,
} from '../typechain-types';
import { BigNumber } from 'ethers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Base', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexCvx: PirexCvx;
  let pirexFees: PirexFees;
  let unionPirex: UnionPirexVault;
  let cvx: ConvexToken;
  let cvxLocker: CvxLockerV2;
  let cvxDelegateRegistry: DelegateRegistry;
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
      cvxLocker,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      pirexFees,
      pxCvx,
      pirexCvx,
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
    it('Should have initialized state variables', async function () {
      const EPOCH_DURATION = await pirexCvx.EPOCH_DURATION();
      const FEE_DENOMINATOR = await pirexCvx.FEE_DENOMINATOR();
      const MAX_REDEMPTION_TIME = await pirexCvx.MAX_REDEMPTION_TIME();
      const _delegationSpace = await pirexCvx.delegationSpace();

      expect(EPOCH_DURATION).to.equal(1209600);
      expect(FEE_DENOMINATOR).to.equal(1000000);
      expect(MAX_REDEMPTION_TIME).to.equal(10281600);
      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const _CVX = await pirexCvx.CVX();
      const _cvxLocker = await pirexCvx.cvxLocker();
      const _cvxDelegateRegistry = await pirexCvx.cvxDelegateRegistry();
      const _pirexFees = await pirexCvx.pirexFees();
      const _votiumMultiMerkleStash = await pirexCvx.votiumMultiMerkleStash();
      const upxCvx = await pirexCvx.upxCvx();
      const vpxCvx = await pirexCvx.vpxCvx();
      const rpxCvx = await pirexCvx.rpxCvx();
      const spxCvx = await pirexCvx.spxCvx();
      const paused = await pirexCvx.paused();
      const outstandingRedemptions = await pirexCvx.outstandingRedemptions();
      const upxCvxDeprecated = await pirexCvx.upxCvxDeprecated();

      expect(_CVX).to.equal(cvx.address);
      expect(_CVX).to.not.equal(zeroAddress);
      expect(_cvxLocker).to.equal(cvxLocker.address);
      expect(_cvxLocker).to.not.equal(zeroAddress);
      expect(_cvxDelegateRegistry).to.equal(cvxDelegateRegistry.address);
      expect(_cvxDelegateRegistry).to.not.equal(zeroAddress);
      expect(_pirexFees).to.equal(pirexFees.address);
      expect(_pirexFees).to.not.equal(zeroAddress);
      expect(_votiumMultiMerkleStash).to.equal(votiumMultiMerkleStash.address);
      expect(_votiumMultiMerkleStash).to.not.equal(zeroAddress);
      expect(upxCvx).to.not.equal(zeroAddress);
      expect(vpxCvx).to.not.equal(zeroAddress);
      expect(rpxCvx).to.not.equal(zeroAddress);
      expect(spxCvx).to.not.equal(zeroAddress);
      expect(paused).to.be.true;
      expect(outstandingRedemptions).to.equal(0);
      expect(upxCvxDeprecated).to.be.false;
    });
  });

  describe('setContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const c = contractEnum.pirexFees;
      const invalidContractAddress = zeroAddress;

      await expect(
        pirexCvx.setContract(c, invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const c = contractEnum.pirexFees;
      const contractAddress = admin.address;

      await expect(
        pirexCvx.connect(notAdmin).setContract(c, contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set pxCvx', async function () {
      const pxCvxBefore = await pirexCvx.pxCvx();
      const c = contractEnum.pxCvx;

      // Deplyo a new temporary PxCvx contract for testing purposes
      const newContract = await (
        await ethers.getContractFactory('PxCvx')
      ).deploy();
      await newContract.setOperator(pirexCvx.address);
      const contractAddress = newContract.address;

      const [setEvent] = await callAndReturnEvents(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const pxCvxAfter = await pirexCvx.pxCvx();

      await pirexCvx.setContract(c, pxCvxBefore);

      expect(pxCvxBefore).to.not.equal(pxCvxAfter);
      expect(pxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set pirexFees', async function () {
      const pirexFeesBefore = await pirexCvx.pirexFees();
      const c = contractEnum.pirexFees;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const pirexFeesAfter = await pirexCvx.pirexFees();

      await pirexCvx.setContract(c, pirexFeesBefore);

      expect(pirexFeesBefore).to.not.equal(pirexFeesAfter);
      expect(pirexFeesAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set upxCvx', async function () {
      const upxCvxBefore = await pirexCvx.upxCvx();
      const c = contractEnum.upxCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const upxCvxAfter = await pirexCvx.upxCvx();

      await pirexCvx.setContract(c, upxCvxBefore);

      expect(upxCvxBefore).to.not.equal(upxCvxAfter);
      expect(upxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress: contractAddress,
      });
    });

    it('Should set spxCvx', async function () {
      const spxCvxBefore = await pirexCvx.spxCvx();
      const c = contractEnum.spxCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const spxCvxAfter = await pirexCvx.spxCvx();

      await pirexCvx.setContract(c, spxCvxBefore);

      expect(spxCvxBefore).to.not.equal(spxCvxAfter);
      expect(spxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      expect(spxCvxBefore).to.equal(await pirexCvx.spxCvx());
    });

    it('Should set vpxCvx', async function () {
      const vpxCvxBefore = await pirexCvx.vpxCvx();
      const c = contractEnum.vpxCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const vpxCvxAfter = await pirexCvx.vpxCvx();

      await pirexCvx.setContract(c, vpxCvxBefore);

      expect(vpxCvxBefore).to.not.equal(vpxCvxAfter);
      expect(vpxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set rpxCvx', async function () {
      const rpxCvxBefore = await pirexCvx.rpxCvx();
      const c = contractEnum.rpxCvx;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const rpxCvxAfter = await pirexCvx.rpxCvx();

      await pirexCvx.setContract(c, rpxCvxBefore);

      expect(rpxCvxBefore).to.not.equal(rpxCvxAfter);
      expect(rpxCvxAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set unionPirex', async function () {
      const unionPirexBefore = await pirexCvx.unionPirex();
      const c = contractEnum.unionPirex;
      const contractAddress = unionPirex.address;
      const events = await callAndReturnEvents(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const approvalEvent = parseLog(pxCvx, events[1]);
      const unionPirexAfter = await pirexCvx.unionPirex();

      expect(unionPirexBefore).to.not.equal(unionPirexAfter);
      expect(unionPirexAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      validateEvent(approvalEvent, 'Approval(address,address,uint256)', {
        owner: pirexCvx.address,
        spender: contractAddress,
        amount: uint256Max,
      });
    });

    it('Should replace unionPirex', async function () {
      const unionPirexAllowanceBefore = await pxCvx.allowance(
        pirexCvx.address,
        unionPirex.address
      );
      const adminAllowanceBefore = await pxCvx.allowance(
        pirexCvx.address,
        admin.address
      );
      const unionPirexBefore = await pirexCvx.unionPirex();
      const c = contractEnum.unionPirex;
      const contractAddress = admin.address;
      const events = await callAndReturnEvents(pirexCvx.setContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const approvalEvent1 = parseLog(pxCvx, events[1]);
      const approvalEvent2 = parseLog(pxCvx, events[2]);
      const unionPirexAfter = await pirexCvx.unionPirex();
      const unionPirexAllowanceAfter = await pxCvx.allowance(
        pirexCvx.address,
        unionPirex.address
      );
      const adminAllowanceAfter = await pxCvx.allowance(
        pirexCvx.address,
        admin.address
      );

      expect(unionPirexBefore).to.not.equal(unionPirexAfter);
      expect(unionPirexAfter).to.equal(contractAddress);
      expect(unionPirexAllowanceBefore).to.not.equal(unionPirexAllowanceAfter);
      expect(unionPirexAllowanceBefore).to.equal(uint256Max);
      expect(unionPirexAllowanceAfter).to.equal(0);
      expect(adminAllowanceBefore).to.not.equal(adminAllowanceAfter);
      expect(adminAllowanceBefore).to.equal(0);
      expect(adminAllowanceAfter).to.equal(uint256Max);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        c,
        contractAddress,
      });
      validateEvent(approvalEvent1, 'Approval(address,address,uint256)', {
        owner: pirexCvx.address,
        spender: unionPirex.address,
        amount: 0,
      });
      validateEvent(approvalEvent2, 'Approval(address,address,uint256)', {
        owner: pirexCvx.address,
        spender: contractAddress,
        amount: uint256Max,
      });

      // Re-set to unionPirex.address to resume normal testing flow
      await pirexCvx.setContract(c, unionPirex.address);
    });
  });

  describe('setConvexContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const c = convexContractEnum.cvxLocker;
      const invalidContractAddress = zeroAddress;

      await expect(
        pirexCvx.setConvexContract(c, invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const c = convexContractEnum.cvxLocker;
      const contractAddress = admin.address;

      await expect(
        pirexCvx.connect(notAdmin).setConvexContract(c, contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set cvxLocker', async function () {
      const cvxLockerBefore = await pirexCvx.cvxLocker();
      const c = convexContractEnum.cvxLocker;
      const contractAddress = admin.address;
      const events = await callAndReturnEvents(pirexCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const setEvent = events[0];
      const cvxLockerAfter = await pirexCvx.cvxLocker();

      // Revert change to appropriate value for future tests
      await pirexCvx.setConvexContract(c, cvxLockerBefore);

      expect(cvxLockerBefore).to.not.equal(cvxLockerAfter);
      expect(cvxLockerAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
    });

    it('Should set cvxDelegateRegistry', async function () {
      const cvxDelegateRegistryBefore = await pirexCvx.cvxDelegateRegistry();
      const c = convexContractEnum.cvxDelegateRegistry;
      const contractAddress = admin.address;
      const setEvent = await callAndReturnEvent(pirexCvx.setConvexContract, [
        c,
        contractAddress,
      ]);
      const cvxDelegateRegistryAfter = await pirexCvx.cvxDelegateRegistry();

      await pirexCvx.setConvexContract(c, cvxDelegateRegistryBefore);

      expect(cvxDelegateRegistryBefore).to.not.equal(cvxDelegateRegistryAfter);
      expect(cvxDelegateRegistryAfter).to.equal(contractAddress);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c,
        contractAddress,
      });
    });
  });

  describe('setFee', function () {
    after(async function () {
      // Unpause only after initial setup is completed on previous steps (setting all token contracts etc.)
      await this.pirexCvx.setPauseState(false);

      // Take a snapshot after setFee tests since we are forwarding an epoch below
      await pxCvx.takeEpochSnapshot();
    });

    it('Should revert if f is not valid Fees enum', async function () {
      const invalidF = 4;
      const fee = 1;

      await expect(pirexCvx.setFee(invalidF, fee)).to.be.reverted;
    });

    it('Should revert if not owner', async function () {
      const f = feesEnum.reward;
      const fee = 1;

      await expect(
        pirexCvx.connect(notAdmin).setFee(f, fee)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should revert if reward fee exceeds max', async function () {
      const f = feesEnum.reward;
      const invalidFee = toBN(await pirexCvx.FEE_MAX()).add(1);

      await expect(pirexCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should revert if redemption max is less than min', async function () {
      const f = feesEnum.redemptionMax;
      const fMin = feesEnum.redemptionMin;

      // Set up initial fees
      await pirexCvx.setFee(f, 1);
      await pirexCvx.setFee(fMin, 1);

      const invalidFee = toBN(await pirexCvx.fees(fMin)).sub(1);

      await expect(pirexCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should revert if redemption min is greater than max', async function () {
      const f = feesEnum.redemptionMin;
      const invalidFee = toBN(await pirexCvx.fees(feesEnum.redemptionMax)).add(
        1
      );

      await expect(pirexCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should set the reward fee', async function () {
      const f = feesEnum.reward;

      await pirexCvx.setFee(f, 0);

      const fee = 1;
      const rewardFeeBefore = await pirexCvx.fees(f);
      const event = await callAndReturnEvent(pirexCvx.setFee, [f, fee]);
      const rewardFeeAfter = await pirexCvx.fees(f);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(fee);

      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee,
      });
    });

    it('Should set the redemption max fee', async function () {
      const f = feesEnum.redemptionMax;
      const redemptionMaxFeeBefore = await pirexCvx.fees(f);
      const fee = toBN(redemptionMaxFeeBefore).add(1);
      const event = await callAndReturnEvent(pirexCvx.setFee, [f, fee]);
      const redemptionMaxFeeAfter = await pirexCvx.fees(f);

      expect(redemptionMaxFeeBefore).to.not.equal(redemptionMaxFeeAfter);
      expect(redemptionMaxFeeAfter).to.equal(fee);

      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee,
      });
    });

    it('Should set the redemption min fee', async function () {
      const f = feesEnum.redemptionMin;
      const redemptionMinFeeBefore = await pirexCvx.fees(f);
      const fee = toBN(redemptionMinFeeBefore).sub(1);
      const event = await callAndReturnEvent(pirexCvx.setFee, [f, fee]);
      const redemptionMinFeeAfter = await pirexCvx.fees(f);

      expect(redemptionMinFeeBefore).to.not.equal(redemptionMinFeeAfter);
      expect(redemptionMinFeeAfter).to.equal(fee);

      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee,
      });
    });
  });

  describe('setDelegationSpace', function () {
    it('Should revert if _delegationSpace is an empty string', async function () {
      const invalidDelegationSpace = '';
      const shouldClear = false;

      await expect(
        pirexCvx.setDelegationSpace(invalidDelegationSpace, shouldClear)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should revert if not called by owner', async function () {
      const shouldClear = false;

      await expect(
        pirexCvx
          .connect(notAdmin)
          .setDelegationSpace(delegationSpace, shouldClear)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should update delegationSpace', async function () {
      const newDelegationSpace = 'test.eth';
      const shouldClear = false;
      const newDelegationSpaceBytes32 =
        ethers.utils.formatBytes32String(newDelegationSpace);
      const delegationSpaceBefore = await pirexCvx.delegationSpace();
      const setEvent = await callAndReturnEvent(pirexCvx.setDelegationSpace, [
        newDelegationSpace,
        shouldClear,
      ]);
      const delegationSpaceAfter = await pirexCvx.delegationSpace();

      expect(delegationSpaceBefore).to.not.equal(delegationSpaceAfter);
      expect(delegationSpaceAfter).to.equal(newDelegationSpaceBytes32);

      validateEvent(setEvent, 'SetDelegationSpace(string,bool)', {
        _delegationSpace: newDelegationSpace,
        shouldClear,
      });
    });

    it('Should clear the vote delegate when setting the delegationSpace (if specified)', async function () {
      await pirexCvx.setVoteDelegate(admin.address);

      const newDelegationSpace = 'test2.eth';
      const shouldClear = true;
      const voteDelegateBefore = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
        await pirexCvx.delegationSpace()
      );
      const setEvent = await callAndReturnEvent(pirexCvx.setDelegationSpace, [
        newDelegationSpace,
        shouldClear,
      ]);
      const voteDelegateAfter = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
        await pirexCvx.delegationSpace()
      );

      expect(voteDelegateBefore).to.not.equal(voteDelegateAfter);
      expect(voteDelegateAfter).to.equal(zeroAddress);

      validateEvent(setEvent, 'SetDelegationSpace(string,bool)', {
        _delegationSpace: newDelegationSpace,
        shouldClear,
      });
    });
  });

  describe('setVoteDelegate', function () {
    it('Should revert if _voteDelegate is zero address', async function () {
      const invalidVoteDelegate = zeroAddress;

      await expect(
        pirexCvx.setVoteDelegate(invalidVoteDelegate)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const voteDelegate = admin.address;

      await expect(
        pirexCvx.connect(notAdmin).setVoteDelegate(voteDelegate)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set voteDelegate', async function () {
      const _delegationSpace = await pirexCvx.delegationSpace();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
        _delegationSpace
      );
      const voteDelegate = admin.address;
      const events = await callAndReturnEvents(pirexCvx.setVoteDelegate, [
        voteDelegate,
      ]);
      const setEvent = events[0];
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
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
        pirexCvx.connect(notAdmin).clearVoteDelegate()
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should remove voteDelegate', async function () {
      const _delegationSpace = await pirexCvx.delegationSpace();
      const convexDelegateBefore = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
        _delegationSpace
      );
      const events = await callAndReturnEvents(pirexCvx.clearVoteDelegate, []);
      const removeEvent = events[0];
      const convexDelegateAfter = await cvxDelegateRegistry.delegation(
        pirexCvx.address,
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
      const currentEpoch = await pirexCvx.getCurrentEpoch();

      expect(expectedCurrentEpoch).to.not.equal(0);
      expect(expectedCurrentEpoch).to.equal(currentEpoch);
    });
  });

  describe('setPauseState', function () {
    it('Should revert if not called by owner', async function () {
      await expect(
        pirexCvx.connect(notAdmin).setPauseState(true)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should pause the contract', async function () {
      const isPausedBefore = await pirexCvx.paused();

      await pirexCvx.setPauseState(true);

      const isPausedAfter = await pirexCvx.paused();

      expect(isPausedBefore).to.be.false;
      expect(isPausedAfter).to.be.true;
    });

    it('Should unpause the contract', async function () {
      const isPausedBefore = await pirexCvx.paused();

      await pirexCvx.setPauseState(false);

      const isPausedAfter = await pirexCvx.paused();

      expect(isPausedBefore).to.be.true;
      expect(isPausedAfter).to.be.false;
    });
  });
});
