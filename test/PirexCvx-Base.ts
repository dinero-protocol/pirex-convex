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
  let pCvx: PirexCvx;
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
    it('Should have initialized state variables', async function () {
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
      const _CVX = await pCvx.CVX();
      const _cvxLocker = await pCvx.cvxLocker();
      const _cvxDelegateRegistry = await pCvx.cvxDelegateRegistry();
      const _pirexFees = await pCvx.pirexFees();
      const _votiumMultiMerkleStash = await pCvx.votiumMultiMerkleStash();
      const upCvx = await pCvx.upCvx();
      const vpCvx = await pCvx.vpCvx();
      const rpCvx = await pCvx.rpCvx();
      const spCvx = await pCvx.spCvx();
      const paused = await pCvx.paused();
      const outstandingRedemptions = await pCvx.outstandingRedemptions();
      const upCvxDeprecated = await pCvx.upCvxDeprecated();

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
      expect(upCvx).to.not.equal(zeroAddress);
      expect(vpCvx).to.not.equal(zeroAddress);
      expect(rpCvx).to.not.equal(zeroAddress);
      expect(spCvx).to.not.equal(zeroAddress);
      expect(paused).to.be.true;
      expect(outstandingRedemptions).to.equal(0);
      expect(upCvxDeprecated).to.be.false;
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
      const unionPirexAllowanceBefore = await pxCvx.allowance(
        pCvx.address,
        unionPirex.address
      );
      const adminAllowanceBefore = await pxCvx.allowance(
        pCvx.address,
        admin.address
      );
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
      const unionPirexAllowanceAfter = await pxCvx.allowance(
        pCvx.address,
        unionPirex.address
      );
      const adminAllowanceAfter = await pxCvx.allowance(
        pCvx.address,
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
      const fee = 1;

      await expect(pCvx.setFee(invalidF, fee)).to.be.reverted;
    });

    it('Should revert if not owner', async function () {
      const f = feesEnum.reward;
      const fee = 1;

      await expect(pCvx.connect(notAdmin).setFee(f, fee)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('Should revert if reward fee exceeds max', async function () {
      const f = feesEnum.reward;
      const invalidFee = toBN(await pCvx.FEE_MAX()).add(1);

      await expect(pCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should revert if redemption max is less than min', async function () {
      const f = feesEnum.redemptionMax;
      const fMin = feesEnum.redemptionMin;

      // Set up initial fees
      await pCvx.setFee(f, 1);
      await pCvx.setFee(fMin, 1);

      const invalidFee = toBN(await pCvx.fees(fMin)).sub(1);

      await expect(pCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should revert if redemption min is greater than max', async function () {
      const f = feesEnum.redemptionMin;
      const invalidFee = toBN(await pCvx.fees(feesEnum.redemptionMax)).add(1);

      await expect(pCvx.setFee(f, invalidFee)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should set the reward fee', async function () {
      const f = feesEnum.reward;

      await pCvx.setFee(f, 0);

      const fee = 1;
      const rewardFeeBefore = await pCvx.fees(f);
      const event = await callAndReturnEvent(pCvx.setFee, [f, fee]);
      const rewardFeeAfter = await pCvx.fees(f);

      expect(rewardFeeBefore).to.equal(0);
      expect(rewardFeeAfter).to.equal(fee);

      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee,
      });
    });

    it('Should set the redemption max fee', async function () {
      const f = feesEnum.redemptionMax;
      const redemptionMaxFeeBefore = await pCvx.fees(f);
      const fee = toBN(redemptionMaxFeeBefore).add(1);
      const event = await callAndReturnEvent(pCvx.setFee, [f, fee]);
      const redemptionMaxFeeAfter = await pCvx.fees(f);

      expect(redemptionMaxFeeBefore).to.not.equal(redemptionMaxFeeAfter);
      expect(redemptionMaxFeeAfter).to.equal(fee);

      validateEvent(event, 'SetFee(uint8,uint32)', {
        f,
        fee,
      });
    });

    it('Should set the redemption min fee', async function () {
      const f = feesEnum.redemptionMin;
      const redemptionMinFeeBefore = await pCvx.fees(f);
      const fee = toBN(redemptionMinFeeBefore).sub(1);
      const event = await callAndReturnEvent(pCvx.setFee, [f, fee]);
      const redemptionMinFeeAfter = await pCvx.fees(f);

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
        pCvx.setDelegationSpace(invalidDelegationSpace, shouldClear)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should revert if not called by owner', async function () {
      const shouldClear = false;

      await expect(
        pCvx.connect(notAdmin).setDelegationSpace(delegationSpace, shouldClear)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should update delegationSpace', async function () {
      const newDelegationSpace = 'test.eth';
      const shouldClear = false;
      const newDelegationSpaceBytes32 =
        ethers.utils.formatBytes32String(newDelegationSpace);
      const delegationSpaceBefore = await pCvx.delegationSpace();
      const setEvent = await callAndReturnEvent(pCvx.setDelegationSpace, [
        newDelegationSpace,
        shouldClear,
      ]);
      const delegationSpaceAfter = await pCvx.delegationSpace();

      expect(delegationSpaceBefore).to.not.equal(delegationSpaceAfter);
      expect(delegationSpaceAfter).to.equal(newDelegationSpaceBytes32);

      validateEvent(setEvent, 'SetDelegationSpace(string,bool)', {
        _delegationSpace: newDelegationSpace,
        shouldClear,
      });
    });

    it('Should clear the vote delegate when setting the delegationSpace (if specified)', async function () {
      await pCvx.setVoteDelegate(admin.address);

      const newDelegationSpace = 'test2.eth';
      const shouldClear = true;
      const voteDelegateBefore = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
      );
      const setEvent = await callAndReturnEvent(pCvx.setDelegationSpace, [
        newDelegationSpace,
        shouldClear,
      ]);
      const voteDelegateAfter = await cvxDelegateRegistry.delegation(
        pCvx.address,
        await pCvx.delegationSpace()
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
