import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  PxCvx,
  PirexCvx,
  ConvexToken,
  Crv,
  MultiMerkleStash,
  WpxCvx,
  CurvePoolHelper,
} from '../typechain-types';
import {
  callAndReturnEvents,
  increaseBlockTimestamp,
  parseLog,
  toBN,
  validateEvent,
} from './helpers';
import { BalanceTree } from '../lib/merkle';

// Tests WpxCvx functionalities tied to the Curve pool
describe('WpxCvx', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexCvx: PirexCvx;
  let cvx: ConvexToken;
  let crv: Crv;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let wpxCvx: WpxCvx;
  let curvePoolHelper: CurvePoolHelper;
  let zeroAddress: string;
  let tokenEnum: any;

  before(async function () {
    ({
      admin,
      notAdmin,
      pxCvx,
      pirexCvx,
      cvx,
      crv,
      votiumMultiMerkleStash,
      wpxCvx,
      curvePoolHelper,
      zeroAddress,
      tokenEnum,
    } = this);

    // Deposit to get pxCVX
    const adminAmount = toBN(100e18);
    await pxCvx.takeEpochSnapshot();
    await cvx.approve(pirexCvx.address, ethers.constants.MaxUint256);
    await pirexCvx.deposit(adminAmount, admin.address, false, zeroAddress);

    // Wrap it into wpxCVX
    const amount = toBN(20e18);
    await pxCvx.approve(wpxCvx.address, ethers.constants.MaxUint256);
    await wpxCvx.wrap(amount);

    // Init the curve pool with equal amounts of CVX-wpxCVX
    await cvx.transfer(curvePoolHelper.address, amount);
    await wpxCvx.transfer(curvePoolHelper.address, amount);
    await curvePoolHelper.initPool(amount, amount);
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const name = await wpxCvx.name();
      const symbol = await wpxCvx.symbol();
      const _pxCvx = await wpxCvx.pxCVX();
      const _pirexCvx = await wpxCvx.pirexCvx();
      const _cvx = await wpxCvx.CVX();
      const pool = await wpxCvx.curvePool();
      const receiver = await wpxCvx.rewardReceiver();

      expect(name).to.equal('Wrapped Pirex CVX');
      expect(symbol).to.equal('wpxCVX');
      expect(_pxCvx).to.equal(pxCvx.address);
      expect(_pirexCvx).to.equal(pirexCvx.address);
      expect(_cvx).to.equal(cvx.address);
      expect(pool).to.equal(zeroAddress);
      expect(receiver).to.equal(admin.address);
    });
  });

  describe('setPirexCvx', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidContractAddress = zeroAddress;

      await expect(
        wpxCvx.setPirexCvx(invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddress = admin.address;

      await expect(
        wpxCvx.connect(notAdmin).setPirexCvx(contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the pirexCvx on valid address', async function () {
      const newPirexCvx = admin.address;
      const pirexCvxBefore = await wpxCvx.pirexCvx();

      await wpxCvx.setPirexCvx(newPirexCvx);

      const pirexCvxAfter = await wpxCvx.pirexCvx();

      expect(pirexCvxAfter).to.not.equal(pirexCvxBefore);
      expect(pirexCvxAfter).to.equal(newPirexCvx);

      // Revert back before next tests
      await wpxCvx.setPirexCvx(pirexCvx.address);
    });
  });

  // Test the PoolNotSet reverts before the setCurvePool test block
  // as we can't revert the pool address to non zero address after
  describe('swap: PoolNotSet', function () {
    it('Should revert if swapping to CVX before the pool is set', async function () {
      await expect(wpxCvx.swap(tokenEnum.cvx, 1, 1)).to.be.revertedWith(
        'PoolNotSet()'
      );
    });
  });

  describe('setCurvePool', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidContractAddress = zeroAddress;

      await expect(
        wpxCvx.setCurvePool(invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddress = admin.address;

      await expect(
        wpxCvx.connect(notAdmin).setCurvePool(contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the curve pool on valid address', async function () {
      const newCurvePool = await curvePoolHelper.poolAddress();
      const curvePoolBefore = await wpxCvx.curvePool();

      await wpxCvx.setCurvePool(newCurvePool);

      const curvePoolAfter = await wpxCvx.curvePool();

      expect(curvePoolAfter).to.not.equal(curvePoolBefore);
      expect(curvePoolAfter).to.equal(newCurvePool);
    });
  });

  describe('setRewardReceiver', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidReceiver = zeroAddress;

      await expect(
        wpxCvx.setRewardReceiver(invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const receiver = admin.address;

      await expect(
        wpxCvx.connect(notAdmin).setRewardReceiver(receiver)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the reward receiver on valid address', async function () {
      const newReceiver = notAdmin.address;
      const receiverBefore = await wpxCvx.rewardReceiver();

      await wpxCvx.setRewardReceiver(newReceiver);

      const receiverAfter = await wpxCvx.rewardReceiver();

      expect(receiverAfter).to.not.equal(receiverBefore);
      expect(receiverAfter).to.equal(newReceiver);
    });
  });

  describe('redeemRewards', function () {
    before(async function () {
      await increaseBlockTimestamp(1209600);

      const cvxRewardDistribution = [
        {
          account: pirexCvx.address,
          amount: toBN(2e18),
        },
      ];
      const crvRewardDistribution = [
        {
          account: pirexCvx.address,
          amount: toBN(2e18),
        },
      ];
      const cvxTree = new BalanceTree(cvxRewardDistribution);
      const crvTree = new BalanceTree(crvRewardDistribution);

      await cvx.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await crv.transfer(votiumMultiMerkleStash.address, toBN(2e18));
      await votiumMultiMerkleStash.updateMerkleRoot(
        cvx.address,
        cvxTree.getHexRoot()
      );
      await votiumMultiMerkleStash.updateMerkleRoot(
        crv.address,
        crvTree.getHexRoot()
      );

      const tokens = [cvx.address, crv.address];
      const indexes = [0, 0];
      const amounts = [
        cvxRewardDistribution[0].amount,
        crvRewardDistribution[0].amount,
      ];
      const proofs = [
        cvxTree.getProof(
          indexes[0],
          pirexCvx.address,
          cvxRewardDistribution[0].amount
        ),
        crvTree.getProof(
          indexes[1],
          pirexCvx.address,
          crvRewardDistribution[0].amount
        ),
      ];
      const votiumRewards: any[] = [
        [tokens[0], indexes[0], amounts[0], proofs[0]],
        [tokens[1], indexes[1], amounts[1], proofs[1]],
      ];

      await pirexCvx.claimVotiumRewards(votiumRewards);
    });

    it('Should redeem rewards', async function () {
      const currentEpoch = await pirexCvx.getCurrentEpoch();
      const { snapshotId, snapshotRewards } = await pxCvx.getEpoch(
        currentEpoch
      );
      const receiver = await wpxCvx.rewardReceiver();
      const cvxBalanceBefore = await cvx.balanceOf(receiver);
      const crvBalanceBefore = await crv.balanceOf(receiver);
      const rewardIndexes = [0, 1];
      const pxCvxBalanceAtSnapshot = await pxCvx.balanceOfAt(
        wpxCvx.address,
        snapshotId
      );
      const pxCvxSupplyAtSnapshot = await pxCvx.totalSupplyAt(snapshotId);
      const cvxSnapshotRewards = snapshotRewards[0];
      const crvSnapshotRewards = snapshotRewards[1];
      const expectedCvxRewards = cvxSnapshotRewards
        .mul(pxCvxBalanceAtSnapshot)
        .div(pxCvxSupplyAtSnapshot);
      const expectedCrvRewards = crvSnapshotRewards
        .mul(pxCvxBalanceAtSnapshot)
        .div(pxCvxSupplyAtSnapshot);
      const events = await callAndReturnEvents(wpxCvx.redeemRewards, [
        currentEpoch,
        rewardIndexes,
      ]);
      const redeemEvent = parseLog(pirexCvx, events[0]);
      const cvxTransferEvent = parseLog(cvx, events[1]);
      const crvTransferEvent = parseLog(crv, events[2]);
      const cvxBalanceAfter = await cvx.balanceOf(receiver);
      const crvBalanceAfter = await crv.balanceOf(receiver);

      expect(cvxBalanceAfter).to.not.equal(cvxBalanceBefore);
      expect(cvxBalanceAfter).to.equal(
        cvxBalanceBefore.add(expectedCvxRewards)
      );
      expect(crvBalanceAfter).to.not.equal(crvBalanceBefore);
      expect(crvBalanceAfter).to.equal(
        crvBalanceBefore.add(expectedCrvRewards)
      );

      validateEvent(
        redeemEvent,
        'RedeemSnapshotRewards(uint256,uint256[],address,uint256,uint256)',
        {
          epoch: currentEpoch,
          rewardIndexes: rewardIndexes.map((i) => toBN(i)),
          receiver,
          snapshotBalance: pxCvxBalanceAtSnapshot,
          snapshotSupply: pxCvxSupplyAtSnapshot,
        }
      );

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: pirexCvx.address,
        to: receiver,
        value: expectedCvxRewards,
      });

      validateEvent(crvTransferEvent, 'Transfer(address,address,uint256)', {
        from: pirexCvx.address,
        to: receiver,
        value: expectedCrvRewards,
      });
    });
  });

  describe('wrap', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;

      await expect(wpxCvx.wrap(invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert on insufficient pxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await pxCvx.balanceOf(admin.address)).mul(2);

      await expect(wpxCvx.wrap(invalidAmount)).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should wrap on valid amount of pxCVX', async function () {
      const amount = toBN(1e18);
      const wpxCvxBalanceBefore = await wpxCvx.balanceOf(admin.address);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(admin.address);

      const events = await callAndReturnEvents(wpxCvx.wrap, [amount]);

      const pxCvxTransferEvent = events[0];
      const wpxCvxTransferEvent = events[1];

      const wpxCvxBalanceAfter = await wpxCvx.balanceOf(admin.address);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(admin.address);

      expect(wpxCvxBalanceAfter).to.equal(wpxCvxBalanceBefore.add(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.sub(amount));

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: wpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: admin.address,
        amount,
      });
    });
  });

  describe('unwrap', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;

      await expect(wpxCvx.unwrap(invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert on insufficient wpxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await wpxCvx.balanceOf(admin.address)).mul(2);

      await expect(wpxCvx.unwrap(invalidAmount)).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should unwrap on valid amount of wpxCVX', async function () {
      const amount = toBN(1e18);
      const wpxCvxBalanceBefore = await wpxCvx.balanceOf(admin.address);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(admin.address);

      const events = await callAndReturnEvents(wpxCvx.unwrap, [amount]);

      const wpxCvxTransferEvent = events[0];
      const pxCvxTransferEvent = events[1];

      const wpxCvxBalanceAfter = await wpxCvx.balanceOf(admin.address);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(admin.address);

      expect(wpxCvxBalanceAfter).to.equal(wpxCvxBalanceBefore.sub(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.add(amount));

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: zeroAddress,
        amount,
      });

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: admin.address,
        amount,
      });
    });
  });

  describe('swap: pxCVX -> CVX', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;
      const validAmount = 1;

      await expect(
        wpxCvx.swap(tokenEnum.pxCvx, invalidAmount, validAmount)
      ).to.be.revertedWith('ZeroAmount()');

      await expect(
        wpxCvx.swap(tokenEnum.pxCvx, validAmount, invalidAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert on insufficient pxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await pxCvx.balanceOf(admin.address)).mul(2);

      await expect(
        wpxCvx.swap(tokenEnum.pxCvx, invalidAmount, invalidAmount)
      ).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should swap to CVX on valid amount of pxCVX', async function () {
      const curvePool = await curvePoolHelper.poolAddress();
      const amount = toBN(1e18);
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(admin.address);
      // Test with zero slippage, thus minReceived = get_dy
      const minReceived = await curvePoolHelper.getDy(1, 0, amount);

      const events = await callAndReturnEvents(wpxCvx.swap, [
        tokenEnum.pxCvx,
        amount,
        minReceived,
      ]);

      const pxCvxTransferEvent = events[0];
      const wpxCvxMintEvent = events[1];
      const wpxCvxTransferEvent = events[2];
      const exchangeEvent = events[3];
      const cvxTransferEvent = events[5];

      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(minReceived));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.sub(amount));

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: wpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: wpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: curvePool,
        amount,
      });

      validateEvent(exchangeEvent, 'Transfer(address,address,uint256)', {
        from: curvePool,
        to: wpxCvx.address,
        amount: minReceived,
      });

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: admin.address,
        amount: minReceived,
      });
    });
  });

  describe('swap: CVX -> pxCVX', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;
      const validAmount = 1;

      await expect(
        wpxCvx.swap(tokenEnum.cvx, invalidAmount, validAmount)
      ).to.be.revertedWith('ZeroAmount()');

      await expect(
        wpxCvx.swap(tokenEnum.cvx, validAmount, invalidAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert on insufficient CVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await cvx.balanceOf(admin.address)).mul(2);

      await expect(
        wpxCvx.swap(tokenEnum.cvx, invalidAmount, invalidAmount)
      ).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should swap to pxCVX on valid amount of CVX', async function () {
      const curvePool = await curvePoolHelper.poolAddress();
      const amount = toBN(1e18);
      const cvxBalanceBefore = await cvx.balanceOf(admin.address);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(admin.address);
      // Test with zero slippage, thus minReceived = get_dy
      const minReceived = await curvePoolHelper.getDy(0, 1, amount);

      await cvx.approve(wpxCvx.address, amount);

      const events = await callAndReturnEvents(wpxCvx.swap, [
        tokenEnum.cvx,
        amount,
        minReceived,
      ]);

      const cvxTransferEvent = events[0];
      const wpxCvxTransferEvent = events[2];
      const exchangeEvent = events[4];
      const wpxCvxBurnEvent = events[6];
      const pxCvxTransferEvent = events[7];

      const cvxBalanceAfter = await cvx.balanceOf(admin.address);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(admin.address);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.add(minReceived));

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: admin.address,
        to: wpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: curvePool,
        amount,
      });

      validateEvent(exchangeEvent, 'Transfer(address,address,uint256)', {
        from: curvePool,
        to: wpxCvx.address,
        amount: minReceived,
      });

      validateEvent(wpxCvxBurnEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: zeroAddress,
        amount: minReceived,
      });

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: wpxCvx.address,
        to: admin.address,
        amount: minReceived,
      });
    });
  });
});
