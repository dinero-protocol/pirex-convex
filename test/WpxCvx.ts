import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  PxCvx,
  PirexCvx,
  ConvexToken,
  Crv,
  MultiMerkleStash,
  LpxCvx,
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

// Tests LpxCvx functionalities tied to the Curve pool
describe('LpxCvx', function () {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let pxCvx: PxCvx;
  let pirexCvx: PirexCvx;
  let cvx: ConvexToken;
  let crv: Crv;
  let votiumMultiMerkleStash: MultiMerkleStash;
  let lpxCvx: LpxCvx;
  let curvePoolHelper: CurvePoolHelper;
  let zeroAddress: string;
  let tokenEnum: any;

  const { MaxUint256: uint256Max } = ethers.constants;

  before(async function () {
    ({
      admin,
      notAdmin,
      pxCvx,
      pirexCvx,
      cvx,
      crv,
      votiumMultiMerkleStash,
      lpxCvx,
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
    await pxCvx.approve(lpxCvx.address, ethers.constants.MaxUint256);
    await lpxCvx.wrap(amount);

    // Init the curve pool with equal amounts of CVX-wpxCVX
    await cvx.transfer(curvePoolHelper.address, amount);
    await lpxCvx.transfer(curvePoolHelper.address, amount);
    await curvePoolHelper.initPool(amount, amount);
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const name = await lpxCvx.name();
      const symbol = await lpxCvx.symbol();
      const _pxCvx = await lpxCvx.pxCVX();
      const _pirexCvx = await lpxCvx.pirexCvx();
      const _cvx = await lpxCvx.CVX();
      const pool = await lpxCvx.curvePool();
      const receiver = await lpxCvx.rewardReceiver();

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
        lpxCvx.setPirexCvx(invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddress = admin.address;

      await expect(
        lpxCvx.connect(notAdmin).setPirexCvx(contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the pirexCvx on valid address', async function () {
      const newPirexCvx = admin.address;
      const pirexCvxBefore = await lpxCvx.pirexCvx();

      await lpxCvx.setPirexCvx(newPirexCvx);

      const pirexCvxAfter = await lpxCvx.pirexCvx();

      expect(pirexCvxAfter).to.not.equal(pirexCvxBefore);
      expect(pirexCvxAfter).to.equal(newPirexCvx);

      // Revert back before next tests
      await lpxCvx.setPirexCvx(pirexCvx.address);
    });
  });

  // Test the PoolNotSet reverts before the setCurvePool test block
  // as we can't revert the pool address to non zero address after
  describe('swap: PoolNotSet', function () {
    it('Should revert if swapping to CVX before the pool is set', async function () {
      await expect(lpxCvx.swap(tokenEnum.cvx, 1, 1, 0, 1)).to.be.revertedWith(
        'PoolNotSet()'
      );
    });
  });

  describe('setCurvePool', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidContractAddress = zeroAddress;

      await expect(
        lpxCvx.setCurvePool(invalidContractAddress)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const contractAddress = admin.address;

      await expect(
        lpxCvx.connect(notAdmin).setCurvePool(contractAddress)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the curve pool', async function () {
      const curvePool = await curvePoolHelper.poolAddress();
      const curvePoolBefore = await lpxCvx.curvePool();
      const [setEvent, cvxApprovalEvent] = await callAndReturnEvents(
        lpxCvx.setCurvePool,
        [curvePool]
      );
      const curvePoolAfter = await lpxCvx.curvePool();

      expect(curvePoolBefore).to.equal(zeroAddress);
      expect(curvePoolAfter).to.not.equal(curvePoolBefore);
      expect(curvePoolAfter).to.equal(curvePool);

      validateEvent(setEvent, 'SetCurvePool(address)', {
        curvePool,
      });

      validateEvent(cvxApprovalEvent, 'Approval(address,address,uint256)', {
        owner: lpxCvx.address,
        spender: curvePool,
        amount: uint256Max,
      });
    });

    it('Should update the curve pool', async function () {
      const newCurvePool = admin.address;
      const curvePoolBefore = await lpxCvx.curvePool();
      const [setEvent, oldCvxApprovalEvent, cvxApprovalEvent] =
        await callAndReturnEvents(lpxCvx.setCurvePool, [newCurvePool]);
      const curvePoolAfter = await lpxCvx.curvePool();

      // Revert changes made for test
      await lpxCvx.setCurvePool(curvePoolBefore);

      expect(curvePoolAfter).to.not.equal(curvePoolBefore);
      expect(curvePoolAfter).to.equal(newCurvePool);

      validateEvent(setEvent, 'SetCurvePool(address)', {
        curvePool: newCurvePool,
      });

      validateEvent(oldCvxApprovalEvent, 'Approval(address,address,uint256)', {
        owner: lpxCvx.address,
        spender: curvePoolBefore,
        amount: 0,
      });

      validateEvent(cvxApprovalEvent, 'Approval(address,address,uint256)', {
        owner: lpxCvx.address,
        spender: newCurvePool,
        amount: uint256Max,
      });
    });
  });

  describe('setRewardReceiver', function () {
    it('Should revert if new address is zero address', async function () {
      const invalidReceiver = zeroAddress;

      await expect(
        lpxCvx.setRewardReceiver(invalidReceiver)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if not called by owner', async function () {
      const receiver = admin.address;

      await expect(
        lpxCvx.connect(notAdmin).setRewardReceiver(receiver)
      ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Should set the reward receiver on valid address', async function () {
      const newReceiver = notAdmin.address;
      const receiverBefore = await lpxCvx.rewardReceiver();

      await lpxCvx.setRewardReceiver(newReceiver);

      const receiverAfter = await lpxCvx.rewardReceiver();

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
      const receiver = await lpxCvx.rewardReceiver();
      const cvxBalanceBefore = await cvx.balanceOf(receiver);
      const crvBalanceBefore = await crv.balanceOf(receiver);
      const rewardIndexes = [0, 1];
      const pxCvxBalanceAtSnapshot = await pxCvx.balanceOfAt(
        lpxCvx.address,
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
      const events = await callAndReturnEvents(lpxCvx.redeemRewards, [
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

      await expect(lpxCvx.wrap(invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert on insufficient pxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await pxCvx.balanceOf(admin.address)).mul(2);

      await expect(lpxCvx.wrap(invalidAmount)).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should wrap on valid amount of pxCVX', async function () {
      const amount = toBN(1e18);
      const account = admin.address;
      const wpxCvxBalanceBefore = await lpxCvx.balanceOf(account);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(account);

      const [wpxCvxTransferEvent, wrapEvent, pxCvxTransferEvent] =
        await callAndReturnEvents(lpxCvx.wrap, [amount]);

      const wpxCvxBalanceAfter = await lpxCvx.balanceOf(account);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(account);

      expect(wpxCvxBalanceAfter).to.equal(wpxCvxBalanceBefore.add(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.sub(amount));

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: account,
        amount,
      });

      validateEvent(wrapEvent, 'Wrap(address,uint256)', {
        account,
        amount,
      });

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: account,
        to: lpxCvx.address,
        amount,
      });
    });
  });

  describe('unwrap', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;

      await expect(lpxCvx.unwrap(invalidAmount)).to.be.revertedWith(
        'ZeroAmount()'
      );
    });

    it('Should revert on insufficient wpxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await lpxCvx.balanceOf(admin.address)).mul(2);

      await expect(lpxCvx.unwrap(invalidAmount)).to.be.revertedWith(
        'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
      );
    });

    it('Should unwrap on valid amount of wpxCVX', async function () {
      const amount = toBN(1e18);
      const account = admin.address;
      const wpxCvxBalanceBefore = await lpxCvx.balanceOf(account);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(account);

      const [wpxCvxTransferEvent, unwrapEvent, pxCvxTransferEvent] =
        await callAndReturnEvents(lpxCvx.unwrap, [amount]);

      const wpxCvxBalanceAfter = await lpxCvx.balanceOf(account);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(account);

      expect(wpxCvxBalanceAfter).to.equal(wpxCvxBalanceBefore.sub(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.add(amount));

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: account,
        to: zeroAddress,
        amount,
      });

      validateEvent(unwrapEvent, 'Unwrap(address,uint256)', {
        account,
        amount,
      });

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: lpxCvx.address,
        to: account,
        amount,
      });
    });
  });

  describe('swap: pxCVX -> CVX', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;
      const validAmount = 1;
      const fromIndex = 1;
      const toIndex = 0;

      await expect(
        lpxCvx.swap(
          tokenEnum.pxCvx,
          invalidAmount,
          validAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith('ZeroAmount()');

      await expect(
        lpxCvx.swap(
          tokenEnum.pxCvx,
          validAmount,
          invalidAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert on invalid indices', async function () {
      const amount = 1;
      const minAmount = 1;
      const fromIndex = 0;
      const toIndex = 0;

      await expect(
        lpxCvx.swap(tokenEnum.pxCvx, amount, minAmount, fromIndex, toIndex)
      ).to.be.revertedWith('InvalidIndices()');
    });

    it('Should revert on insufficient pxCVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await pxCvx.balanceOf(admin.address)).mul(2);
      const fromIndex = 1;
      const toIndex = 0;

      await expect(
        lpxCvx.swap(
          tokenEnum.pxCvx,
          invalidAmount,
          invalidAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should swap to CVX on valid amount of pxCVX', async function () {
      const curvePool = await curvePoolHelper.poolAddress();
      const amount = toBN(1e18);
      const account = admin.address;
      const fromIndex = 1;
      const toIndex = 0;
      const cvxBalanceBefore = await cvx.balanceOf(account);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(account);
      // Test with zero slippage, thus minReceived = get_dy
      const minReceived = await curvePoolHelper.getDy(1, 0, amount);

      const events = await callAndReturnEvents(lpxCvx.swap, [
        tokenEnum.pxCvx,
        amount,
        minReceived,
        fromIndex,
        toIndex,
      ]);

      const pxCvxTransferEvent = events[0];
      const wpxCvxMintEvent = events[1];
      const wpxCvxTransferEvent = events[2];
      const exchangeEvent = events[3];
      const swapEvent = events[5];

      const cvxBalanceAfter = await cvx.balanceOf(account);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(account);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.add(minReceived));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.sub(amount));

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: account,
        to: lpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxMintEvent, 'Transfer(address,address,uint256)', {
        from: zeroAddress,
        to: lpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: lpxCvx.address,
        to: curvePool,
        amount,
      });

      validateEvent(exchangeEvent, 'Transfer(address,address,uint256)', {
        from: curvePool,
        to: account,
        amount: minReceived,
      });

      validateEvent(swapEvent, 'Swap(address,uint8,uint256,uint256)', {
        account: account,
        source: tokenEnum.pxCvx,
        sent: amount,
        received: minReceived,
      });
    });
  });

  describe('swap: CVX -> pxCVX', function () {
    it('Should revert on zero amount', async function () {
      const invalidAmount = 0;
      const validAmount = 1;
      const fromIndex = 0;
      const toIndex = 1;

      await expect(
        lpxCvx.swap(
          tokenEnum.cvx,
          invalidAmount,
          validAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith('ZeroAmount()');

      await expect(
        lpxCvx.swap(
          tokenEnum.cvx,
          validAmount,
          invalidAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert on invalid indices', async function () {
      const amount = 1;
      const minAmount = 1;
      const fromIndex = 0;
      const toIndex = 0;

      await expect(
        lpxCvx.swap(tokenEnum.cvx, amount, minAmount, fromIndex, toIndex)
      ).to.be.revertedWith('InvalidIndices()');
    });

    it('Should revert on insufficient CVX balance', async function () {
      // Use double the available balance
      const invalidAmount = (await cvx.balanceOf(admin.address)).mul(2);
      const fromIndex = 0;
      const toIndex = 1;

      await expect(
        lpxCvx.swap(
          tokenEnum.cvx,
          invalidAmount,
          invalidAmount,
          fromIndex,
          toIndex
        )
      ).to.be.revertedWith(
        "VM Exception while processing transaction: reverted with reason string 'TRANSFER_FROM_FAILED'"
      );
    });

    it('Should swap to pxCVX on valid amount of CVX', async function () {
      const curvePool = await curvePoolHelper.poolAddress();
      const amount = toBN(1e18);
      const account = admin.address;
      const fromIndex = 0;
      const toIndex = 1;
      const cvxBalanceBefore = await cvx.balanceOf(account);
      const pxCvxBalanceBefore = await pxCvx.balanceOf(account);
      // Test with zero slippage, thus minReceived = get_dy
      const minReceived = await curvePoolHelper.getDy(0, 1, amount);

      await cvx.approve(lpxCvx.address, amount);

      const events = await callAndReturnEvents(lpxCvx.swap, [
        tokenEnum.cvx,
        amount,
        minReceived,
        fromIndex,
        toIndex,
      ]);

      const cvxTransferEvent = events[0];
      const wpxCvxTransferEvent = events[2];
      const exchangeEvent = events[4];
      const wpxCvxBurnEvent = events[6];
      const pxCvxTransferEvent = events[7];
      const swapEvent = events[8];

      const cvxBalanceAfter = await cvx.balanceOf(account);
      const pxCvxBalanceAfter = await pxCvx.balanceOf(account);

      expect(cvxBalanceAfter).to.equal(cvxBalanceBefore.sub(amount));
      expect(pxCvxBalanceAfter).to.equal(pxCvxBalanceBefore.add(minReceived));

      validateEvent(cvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: account,
        to: lpxCvx.address,
        amount,
      });

      validateEvent(wpxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: lpxCvx.address,
        to: curvePool,
        amount,
      });

      validateEvent(exchangeEvent, 'Transfer(address,address,uint256)', {
        from: curvePool,
        to: lpxCvx.address,
        amount: minReceived,
      });

      validateEvent(wpxCvxBurnEvent, 'Transfer(address,address,uint256)', {
        from: lpxCvx.address,
        to: zeroAddress,
        amount: minReceived,
      });

      validateEvent(pxCvxTransferEvent, 'Transfer(address,address,uint256)', {
        from: lpxCvx.address,
        to: account,
        amount: minReceived,
      });

      validateEvent(swapEvent, 'Swap(address,uint8,uint256,uint256)', {
        account: account,
        source: tokenEnum.cvx,
        sent: amount,
        received: minReceived,
      });
    });
  });
});
