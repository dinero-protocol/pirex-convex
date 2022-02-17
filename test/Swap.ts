import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
} from './helpers';
import { BigNumber } from 'ethers';
import {
  Cvx,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  UniswapV2Factory,
  UniswapV2Router02,
} from '../typechain-types';

describe('Swap', () => {
  let admin: SignerWithAddress;
  let cvx: Cvx;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;
  let swapFactory: UniswapV2Factory;
  let swapRouter: UniswapV2Router02;
  let firstPairAddress: string;
  let firstLockedCvxAddress: string;

  const crvAddr = '0xd533a949740bb3306d119cc777fa900ba034cd52';
  const crvDepositorAddr = '0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae';
  const cvxCrvRewardsAddr = '0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e';
  const cvxCrvTokenAddr = '0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7';
  const cvxDelegateRegistry = '0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446';
  const votiumMultiMerkleStash = '0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A';
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const wethAddress = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';

  before(async () => {
    [admin] = await ethers.getSigners();

    const CVX = await ethers.getContractFactory('Cvx');
    const CVXLocker = await ethers.getContractFactory('CvxLocker');
    const CVXRewardPool = await ethers.getContractFactory('CvxRewardPool');
    const PirexCVX = await ethers.getContractFactory('PirexCvx');
    const SwapFactory = await ethers.getContractFactory('UniswapV2Factory');
    const SwapRouter = await ethers.getContractFactory('UniswapV2Router02');

    cvx = await CVX.deploy();
    cvxLocker = await CVXLocker.deploy(cvx.address);
    cvxRewardPool = await CVXRewardPool.deploy(
      cvx.address,
      crvAddr,
      crvDepositorAddr,
      cvxCrvRewardsAddr,
      cvxCrvTokenAddr,
      admin.address,
      admin.address
    );
    cvxLockerLockDuration = await cvxLocker.lockDuration();
    pirexCvx = await PirexCVX.deploy(
      cvxLocker.address,
      cvx.address,
      cvxRewardPool.address,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      initialEpochDepositDuration,
      cvxLockerLockDuration,
      admin.address
    );
    swapFactory = await SwapFactory.deploy(admin.address);
    swapRouter = await SwapRouter.deploy(swapFactory.address, wethAddress);

    await cvxLocker.setStakingContract(
      '0xe096ccec4a1d36f191189fe61e803d8b2044dfc3'
    );
    await cvxLocker.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt('ERC20PresetMinterPauserUpgradeable', address);

  describe('createPair', () => {
    it('Should create pair for new pair of distinct tokens', async () => {
      // Simulate Pirex deposit to trigger all the cvx token creations
      const depositAmount = toBN(5e18);

      await cvx.approve(pirexCvx.address, depositAmount);

      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);
      const rewardsDuration = convertBigNumberToNumber(
        await cvxLocker.rewardsDuration()
      );

      // Convex does not reflect actual locked CVX until their next epoch (1 week)
      await increaseBlockTimestamp(rewardsDuration);

      firstLockedCvxAddress = depositEvent.args.token;

      // Attempt to create the WETH/lockedCVX pair
      const createPairEvent = await callAndReturnEvent(swapFactory.createPair, [
        wethAddress,
        firstLockedCvxAddress,
      ]);
      firstPairAddress = createPairEvent.args.pair;
      const orderPairTokens = (tokenA: string, tokenB: string) => {
        const lowerCaseTokenA = tokenA.toLowerCase();
        const lowerCaseTokenB = tokenB.toLowerCase();
        return Number(tokenA) < Number(tokenB)
          ? [lowerCaseTokenA, lowerCaseTokenB]
          : [lowerCaseTokenB, lowerCaseTokenA];
      };
      const [token0, token1] = orderPairTokens(wethAddress, firstLockedCvxAddress);

      expect(createPairEvent.eventSignature).to.equal(
        'PairCreated(address,address,address,uint256)'
      );

      expect(createPairEvent.args.token0.toLowerCase()).to.be.equal(token0);
      expect(createPairEvent.args.token1.toLowerCase()).to.be.equal(token1);
      expect(createPairEvent.args.token1.toLowerCase()).to.not.equal(
        createPairEvent.args.token0.toLowerCase()
      );
      expect(createPairEvent.args.pair).to.not.equal(zeroAddress);
    });

    it('Should not create pair for existing pair of distinct tokens', async () => {
      await expect(
        swapFactory.createPair(firstLockedCvxAddress, wethAddress)
      ).to.be.revertedWith('UniswapV2: PAIR_EXISTS');
    });

    it('Should not create pair for identical tokens', async () => {
      await expect(
        swapFactory.createPair(firstLockedCvxAddress, firstLockedCvxAddress)
      ).to.be.revertedWith('UniswapV2: IDENTICAL_ADDRESSES');
    });
  });

  describe('addLiquidity', () => {
    it('Should add liquidity for valid pair', async () => {
      const amount0 = toBN(1e17);
      const amount1 = toBN(1e18);
      const { timestamp } = await ethers.provider.getBlock('latest');
      const expiry = timestamp + 60;
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      const lpToken = await ethers.getContractAt(
        'UniswapV2Pair',
        firstPairAddress
      );
      const lpBalanceBefore = await lpToken.balanceOf(admin.address);

      await lockedCvxToken.approve(swapRouter.address, amount1);

      await swapRouter.addLiquidityETH(
        firstLockedCvxAddress,
        amount1,
        amount1,
        amount0,
        admin.address,
        expiry,
        {
          value: amount0,
        }
      );

      const lpBalanceAfter = await lpToken.balanceOf(admin.address);
      expect(lpBalanceAfter).to.be.gt(lpBalanceBefore);
    });
  });

  describe('swapExactTokensForETH', () => {
    it('Should swap exact amount of tokens for ETH', async () => {
      const amountIn = toBN(1e17);
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      const { timestamp } = await ethers.provider.getBlock('latest');
      const expiry = timestamp + 60;
      const quotes = await swapRouter.getAmountsOut(amountIn, [
        firstLockedCvxAddress,
        wethAddress,
      ]);
      const slippage = 1; // 1%
      const amountOutMin = quotes[quotes.length - 1].sub(
        quotes[quotes.length - 1].mul(slippage).div(100)
      );

      await lockedCvxToken
        .approve(swapRouter.address, amountIn);

      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);
      const lockedBalanceBefore = await lockedCvxToken.balanceOf(
        admin.address
      );

      const tx = await swapRouter
        .swapExactTokensForETH(
          amountIn,
          amountOutMin,
          [firstLockedCvxAddress, wethAddress],
          admin.address,
          expiry
        );
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(
        admin.address
      );

      expect(lockedBalanceBefore.sub(lockedBalanceAfter)).to.be.eq(amountIn);
      expect(ethBalanceAfter.sub(ethBalanceBefore).add(gasUsed)).to.be.gte(amountOutMin);
    });
  });

  describe('swapExactETHForTokens', () => {
    it('Should swap exact amount of ETH for tokens', async () => {
      const amountIn = toBN(1e16);
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      const { timestamp } = await ethers.provider.getBlock('latest');
      const expiry = timestamp + 60;
      const quotes = await swapRouter.getAmountsOut(amountIn, [
        wethAddress,
        firstLockedCvxAddress,
      ]);
      const slippage = 1; // 1%
      const amountOutMin = quotes[quotes.length - 1].sub(
        quotes[quotes.length - 1].mul(slippage).div(100)
      );

      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);
      const lockedBalanceBefore = await lockedCvxToken.balanceOf(admin.address);

      await swapRouter.swapExactETHForTokens(
        amountOutMin,
        [wethAddress, firstLockedCvxAddress],
        admin.address,
        expiry,
        {
          value: amountIn,
        }
      );

      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(admin.address);

      expect(lockedBalanceAfter.sub(lockedBalanceBefore)).to.be.gte(
        amountOutMin
      );
      expect(ethBalanceBefore.sub(ethBalanceAfter)).to.be.gte(amountIn);
    });
  });

  describe('removeLiquidity', () => {
    it('Should remove liquidity for valid pair with sufficient LP balance', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const expiry = timestamp + 60;
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      const lpToken = await ethers.getContractAt(
        'UniswapV2Pair',
        firstPairAddress
      );
      const lpBalanceBefore = await lpToken.balanceOf(admin.address);
      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);
      const lockedBalanceBefore = await lockedCvxToken.balanceOf(admin.address);
      const lpBalanceToRemove = await lpBalanceBefore.div(2);
      const amount0 = 0;
      const amount1 = 0;

      await lpToken.approve(swapRouter.address, lpBalanceToRemove);

      await swapRouter.removeLiquidityETH(
        firstLockedCvxAddress,
        lpBalanceToRemove,
        amount0,
        amount1,
        admin.address,
        expiry
      );

      const lpBalanceAfter = await lpToken.balanceOf(admin.address);
      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(admin.address);

      expect(lpBalanceBefore).to.be.gt(lpBalanceAfter);
      expect(ethBalanceAfter).to.be.gt(ethBalanceBefore);
      expect(lockedBalanceAfter).to.be.gt(lockedBalanceBefore);
    });
  });
});
