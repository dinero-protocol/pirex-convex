import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  callAndReturnEvents,
  toBN,
  validateEvent,
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
  MultiMerkleStash,
  PirexFees,
  CvxRewardPool,
} from '../typechain-types';
import { BigNumber } from 'ethers';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Base', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pCvx: PirexCvx;
  let pirexFees: PirexFees;
  let cvx: ConvexToken;
  let cvxCrvToken: any;
  let cvxLocker: CvxLocker;
  let cvxDelegateRegistry: DelegateRegistry;
  let cvxRewardPool: CvxRewardPool;
  let votiumMultiMerkleStash: MultiMerkleStash;

  let zeroAddress: string;
  let feeDenominator: number;
  let epochDuration: BigNumber;

  let delegationSpace: string;
  let delegationSpaceBytes32: string;
  let contractEnum: any;
  let convexContractEnum: any;
  let feesEnum: any;

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
      pCvx,
      feeDenominator,
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
      const pirexEpochDuration = await pCvx.EPOCH_DURATION();
      const _delegationSpace = await pCvx.delegationSpace();

      expect(pirexEpochDuration).to.equal(1209600);
      expect(feeDenominator).to.equal(1000000);

      expect(_delegationSpace).to.equal(delegationSpaceBytes32);
    });
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const { snapshotId } = await pCvx.getEpoch(await pCvx.getCurrentEpoch());
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
      expect(_cvxCRV).to.equal(cvxCrvToken.address);
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

  describe('setContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setContract(contractEnum.pirexFees, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddr = admin.address;

      await expect(
        pCvx.connect(notAdmin).setContract(contractEnum.pirexFees, contractAddr)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set pirexFees', async function () {
      const pirexFeesBefore = await pCvx.pirexFees();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.pirexFees,
        admin.address,
      ]);
      const pirexFeesAfter = await pCvx.pirexFees();

      await pCvx.setContract(contractEnum.pirexFees, pirexFeesBefore);

      expect(pirexFeesBefore).to.not.equal(pirexFeesAfter);
      expect(pirexFeesAfter).to.equal(admin.address);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        contractAddress: admin.address,
        c: contractEnum.pirexFees,
      });
      expect(pirexFeesBefore).to.equal(await pCvx.pirexFees());
    });

    it('Should set upCvx', async function () {
      const upCvxBefore = await pCvx.upCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.upCvx,
        admin.address,
      ]);
      const upCvxAfter = await pCvx.upCvx();

      await pCvx.setContract(contractEnum.upCvx, upCvxBefore);

      expect(upCvxBefore).to.not.equal(upCvxAfter);
      expect(upCvxAfter).to.equal(admin.address);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        contractAddress: admin.address,
        c: contractEnum.upCvx,
      });
      expect(upCvxBefore).to.equal(await pCvx.upCvx());
    });

    it('Should set vpCvx', async function () {
      const vpCvxBefore = await pCvx.vpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.vpCvx,
        admin.address,
      ]);
      const vpCvxAfter = await pCvx.vpCvx();

      await pCvx.setContract(contractEnum.vpCvx, vpCvxBefore);

      expect(vpCvxBefore).to.not.equal(vpCvxAfter);
      expect(vpCvxAfter).to.equal(admin.address);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        contractAddress: admin.address,
        c: contractEnum.vpCvx,
      });
      expect(vpCvxBefore).to.equal(await pCvx.vpCvx());
    });

    it('Should set rpCvx', async function () {
      const rpCvxBefore = await pCvx.rpCvx();
      const setEvent = await callAndReturnEvent(pCvx.setContract, [
        contractEnum.rpCvx,
        admin.address,
      ]);
      const rpCvxAfter = await pCvx.rpCvx();

      await pCvx.setContract(contractEnum.rpCvx, rpCvxBefore);

      expect(rpCvxBefore).to.not.equal(rpCvxAfter);
      expect(rpCvxAfter).to.equal(admin.address);
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        contractAddress: admin.address,
        c: contractEnum.rpCvx,
      });
      expect(rpCvxBefore).to.equal(await pCvx.rpCvx());
    });

    it('Should set spCvxImplementation', async function () {
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
      validateEvent(setEvent, 'SetContract(uint8,address)', {
        contractAddress: admin.address,
        c: contractEnum.spCvxImplementation,
      });
      expect(spCvxImplementationBefore).to.equal(
        await pCvx.spCvxImplementation()
      );
    });
  });

  describe('setConvexContract', function () {
    it('Should revert if contractAddress is zero address', async function () {
      const invalidAddress = zeroAddress;

      await expect(
        pCvx.setConvexContract(convexContractEnum.cvxLocker, invalidAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const _cvxLocker = admin.address;

      await expect(
        pCvx
          .connect(notAdmin)
          .setConvexContract(convexContractEnum.cvxLocker, _cvxLocker)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set cvxLocker', async function () {
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
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        contractAddress: admin.address,
        c: convexContractEnum.cvxLocker,
      });

      // Test change reversion
      expect(cvxLockerBefore).to.equal(await pCvx.cvxLocker());
    });

    it('Should set cvxDelegateRegistry', async function () {
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
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        contractAddress: admin.address,
        c: convexContractEnum.cvxDelegateRegistry,
      });
      expect(cvxDelegateRegistryBefore).to.equal(
        await pCvx.cvxDelegateRegistry()
      );
    });

    it('Should set cvxRewardPool', async function () {
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
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        contractAddress: admin.address,
        c: convexContractEnum.cvxRewardPool,
      });
      expect(cvxRewardPoolBefore).to.equal(await pCvx.cvxRewardPool());
    });

    it('Should set cvxCrvToken', async function () {
      const cvxCrvTokenBefore = await pCvx.cvxCRV();
      const setEvent = await callAndReturnEvent(pCvx.setConvexContract, [
        convexContractEnum.cvxCrvToken,
        admin.address,
      ]);
      const cvxCrvTokenAfter = await pCvx.cvxCRV();

      await pCvx.setConvexContract(
        convexContractEnum.cvxCrvToken,
        cvxCrvTokenBefore
      );

      expect(cvxCrvTokenBefore).to.not.equal(cvxCrvTokenAfter);
      expect(cvxCrvTokenAfter).to.equal(admin.address);
      validateEvent(setEvent, 'SetConvexContract(uint8,address)', {
        c: convexContractEnum.cvxCrvToken,
        contractAddress: admin.address,
      });
      expect(cvxCrvTokenBefore).to.equal(await pCvx.cvxCRV());
    });
  });

  describe('setFee', function () {
    it('Should revert if f is not valid Fees enum', async function () {
      const invalidF = 2;
      const amount = 1;

      await expect(pCvx.setFee(invalidF, amount)).to.be.reverted;
    });

    it('Should revert if amount is larger than 50000', async function () {
      const f = feesEnum.deposit;
      const invalidAmount = 50001;

      await expect(pCvx.setFee(f, invalidAmount)).to.be.revertedWith(
        'InvalidFee()'
      );
    });

    it('Should revert if amount is not uint16', async function () {
      const f = feesEnum.deposit;
      const invalidAmount = 2 ** 16;

      // This would actually revert before the tx is even sent out (due to invalid data type)
      // without triggering InvalidFee() revert
      await expect(pCvx.setFee(f, invalidAmount)).to.be.reverted;
    });

    it('Should revert if not owner', async function () {
      const f = feesEnum.deposit;
      const amount = 1;

      await expect(pCvx.connect(notAdmin).setFee(f, amount)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      );
    });

    it('Should set the deposit fee', async function () {
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
      validateEvent(setEvent, 'SetFee(uint8,uint16)', {
        amount,
        f: feesEnum.deposit,
      });
    });

    it('Should set the reward fee', async function () {
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
      validateEvent(setEvent, 'SetFee(uint8,uint16)', {
        amount,
        f: feesEnum.reward,
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
      expect(delegationSpaceBefore).to.equal(await pCvx.delegationSpace());
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
      validateEvent(setEvent, 'SetVoteDelegate(address)', {
        _voteDelegate: voteDelegate,
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
      const { snapshotId } = await pCvx.getEpoch(currentEpoch);
      const currentSnapshotId = await pCvx.getCurrentSnapshotId();

      expect(snapshotId).to.equal(1);
      expect(snapshotId).to.equal(currentSnapshotId);
    });
  });
});
