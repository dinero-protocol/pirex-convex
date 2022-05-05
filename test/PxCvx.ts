import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber } from 'ethers';
import { every } from 'lodash';
import {
  PxCvx,
  PirexCvx,
  MultiMerkleStash,
  ConvexToken,
  Crv,
} from '../typechain-types';
import {
  callAndReturnEvents,
  increaseBlockTimestamp,
  toBN,
  validateEvent,
} from './helpers';
import { BalanceTree } from '../lib/merkle';

// Tests foundational units outside of the actual deposit flow
describe('PxCvx', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let crv: Crv;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let futuresEnum: any;
  let zeroAddress: string;

  before(async function () {
    ({
      admin,
      notAdmin,
      pxCvx,
      pCvx,
      cvx,
      crv,
      votiumMultiMerkleStash,
      zeroAddress,
      futuresEnum,
    } = this);
  });

  describe('constructor', function () {
    before(async function () {
      // Take snapshot if one hasn't been taken (due to increasing block timestamp)
      await pxCvx.takeEpochSnapshot();
    });

    it('Should set up contract state', async function () {
      const { snapshotId } = await pxCvx.getEpoch(await pCvx.getCurrentEpoch());
      const _name = await pxCvx.name();
      const _symbol = await pxCvx.symbol();

      expect(snapshotId).to.not.equal(0);
      expect(_name).to.equal('Pirex CVX');
      expect(_symbol).to.equal('pxCVX');
    });
  });

  describe('getCurrentSnapshotId', function () {
    it('Should return the current snapshot id', async function () {
      const currentEpoch = await pCvx.getCurrentEpoch();
      const { snapshotId } = await pxCvx.getEpoch(currentEpoch);
      const currentSnapshotId = await pxCvx.getCurrentSnapshotId();

      expect(snapshotId).to.not.equal(0);
      expect(snapshotId).to.equal(currentSnapshotId);
    });
  });

  describe('setOperator', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidContractAddress = zeroAddress;

      await expect(
        pxCvx.setOperator(invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddress = admin.address;

      await expect(
        pxCvx.connect(notAdmin).setOperator(contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set a new operator on valid address', async function () {
      const newOperator = admin.address;
      const operatorBefore = await pxCvx.operator();

      await pxCvx.setOperator(newOperator);

      const operatorAfter = await pxCvx.operator();

      expect(operatorAfter).to.not.equal(operatorBefore);
      expect(operatorAfter).to.equal(newOperator);
    });
  });

  describe('mint', function () {
    it('Should revert if not called by operator', async function () {
      const recipient = admin.address;
      const amount = BigNumber.from(1);

      await expect(
        pxCvx.connect(notAdmin).mint(recipient, amount)
      ).to.be.revertedWith('NotAuthorized()');
    });

    it('Should revert if recipient is zero address', async function () {
      const invalidRecipient = zeroAddress;
      const amount = BigNumber.from(1);

      await expect(pxCvx.mint(invalidRecipient, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if amount is 0', async function () {
      const recipient = admin.address;
      const amount = BigNumber.from(0);

      await expect(pxCvx.mint(recipient, amount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should mint tokens based on specified recipient and amount by operator', async function () {
      const recipient = admin.address;
      const amount = BigNumber.from(`${1e18}`);
      const balanceBefore = await pxCvx.balanceOf(recipient);

      await pxCvx.mint(recipient, amount);

      const balanceAfter = await pxCvx.balanceOf(recipient);

      expect(balanceAfter).to.be.gt(balanceBefore);
      expect(balanceAfter).to.equal(balanceBefore.add(amount));
    });
  });

  describe('burn', function () {
    it('Should revert if not called by operator', async function () {
      const account = admin.address;
      const amount = BigNumber.from(1);

      await expect(
        pxCvx.connect(notAdmin).burn(account, amount)
      ).to.be.revertedWith('NotAuthorized()');
    });

    it('Should revert if account is zero address', async function () {
      const invalidAccount = zeroAddress;
      const amount = BigNumber.from(1);

      await expect(pxCvx.burn(invalidAccount, amount)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should revert if amount is 0', async function () {
      const account = admin.address;
      const invalidAmount = BigNumber.from(0);

      await expect(pxCvx.burn(account, invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert when burning more tokens than owned', async function () {
      const account = admin.address;
      const balance = await pxCvx.balanceOf(account);
      const invalidAmount = balance.add(1);

      await expect(pxCvx.burn(account, invalidAmount)).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should burn tokens based on specified recipient and amount by operator', async function () {
      const account = admin.address;
      const amount = BigNumber.from(`${1e18}`);
      const balanceBefore = await pxCvx.balanceOf(account);

      await pxCvx.burn(account, amount);

      const balanceAfter = await pxCvx.balanceOf(account);

      expect(balanceBefore).to.be.gt(balanceAfter);
      expect(balanceAfter).to.equal(balanceBefore.sub(amount));
    });
  });

  describe('addEpochRewardMetadata', function () {
    it('Should revert if not called by operator', async function () {
      await expect(
        pxCvx
          .connect(notAdmin)
          .addEpochRewardMetadata(0, ethers.utils.formatBytes32String(''), 0, 0)
      ).to.be.revertedWith('NotAuthorized()');
    });
  });

  describe('setEpochRedeemedSnapshotRewards', function () {
    it('Should revert if not called by operator', async function () {
      await expect(
        pxCvx
          .connect(notAdmin)
          .setEpochRedeemedSnapshotRewards(admin.address, 0, 0)
      ).to.be.revertedWith('NotAuthorized()');
    });
  });

  describe('updateEpochFuturesRewards', function () {
    before(async function () {
      await pxCvx.setOperator(pCvx.address);
      await pCvx.stake(
        1,
        futuresEnum.reward,
        (await pxCvx.balanceOf(admin.address)).div(2),
        admin.address
      );
      await increaseBlockTimestamp(1209600);

      const cvxRewards = toBN(1e18);
      const crvRewards = toBN(1e18);
      await cvx.transfer(votiumMultiMerkleStash.address, cvxRewards);
      await crv.transfer(votiumMultiMerkleStash.address, crvRewards);

      await votiumMultiMerkleStash.updateMerkleRoot(
        cvx.address,
        new BalanceTree([
          {
            account: pCvx.address,
            amount: cvxRewards,
          },
        ]).getHexRoot()
      );
      await votiumMultiMerkleStash.updateMerkleRoot(
        crv.address,
        new BalanceTree([
          {
            account: pCvx.address,
            amount: crvRewards,
          },
        ]).getHexRoot()
      );
      await pCvx.claimVotiumRewards([
        {
          token: cvx.address,
          index: 0,
          amount: cvxRewards,
          merkleProof: [],
        },
        {
          token: crv.address,
          index: 0,
          amount: crvRewards,
          merkleProof: [],
        },
      ]);
      await pxCvx.setOperator(admin.address);
    });

    it('Should revert if not called by operator', async function () {
      const epoch = await pxCvx.getCurrentEpoch();
      const futuresRewards = (await pxCvx.getEpoch(epoch)).futuresRewards;

      await expect(
        pxCvx.connect(notAdmin).updateEpochFuturesRewards(epoch, futuresRewards)
      ).to.be.revertedWith('NotAuthorized()');
    });

    it('Should revert if epoch is zero', async function () {
      const invalidEpoch = 0;
      const futuresRewards = (await pxCvx.getEpoch(invalidEpoch))
        .futuresRewards;

      await expect(
        pxCvx.updateEpochFuturesRewards(invalidEpoch, futuresRewards)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if there are no futures rewards to update', async function () {
      const epoch = 1;
      const invalidFuturesRewards = (await pxCvx.getEpoch(epoch))
        .futuresRewards;

      await expect(
        pxCvx.updateEpochFuturesRewards(epoch, invalidFuturesRewards)
      ).to.be.revertedWith('InvalidEpoch()');
    });

    it('Should revert if futuresReward is an empty array', async function () {
      const epoch = await pxCvx.getCurrentEpoch();
      const invalidFuturesRewards: any[] = [];

      await expect(
        pxCvx.updateEpochFuturesRewards(epoch, invalidFuturesRewards)
      ).to.be.revertedWith('InvalidFuturesRewards()');
    });

    it('Should revert if futuresReward has a different length than stored', async function () {
      const epoch = await pxCvx.getCurrentEpoch();
      const invalidFuturesRewards: any[] = (
        await pxCvx.getEpoch(epoch)
      ).futuresRewards.slice(1);

      await expect(
        pxCvx.updateEpochFuturesRewards(epoch, invalidFuturesRewards)
      ).to.be.revertedWith('MismatchedFuturesRewards()');
    });

    it('Should update futuresReward', async function () {
      const epoch = await pxCvx.getCurrentEpoch();
      const { futuresRewards: futuresRewardsBefore } = await pxCvx.getEpoch(
        epoch
      );
      const updatedFuturesRewards = futuresRewardsBefore.map(
        (amount: BigNumber) => amount.add(amount)
      );
      const events = await callAndReturnEvents(
        pxCvx.updateEpochFuturesRewards,
        [epoch, updatedFuturesRewards]
      );
      const updateEvent = events[0];
      const { futuresRewards: futuresRewardsAfter } = await pxCvx.getEpoch(
        epoch
      );

      expect(
        every(updatedFuturesRewards, (value, index) =>
          value.eq(futuresRewardsAfter[index])
        )
      ).to.equal(true);

      validateEvent(
        updateEvent,
        'UpdateEpochFuturesRewards(uint256,uint256[])',
        {
          epoch,
          futuresRewards: updatedFuturesRewards,
        }
      );
    });
  });

  describe('takeEpochSnapshot', function () {
    it('Should revert if not called by operator', async function () {
      await expect(
        pxCvx
          .connect(notAdmin)
          .setEpochRedeemedSnapshotRewards(admin.address, 0, 0)
      ).to.be.revertedWith('NotAuthorized()');
    });
  });
});
