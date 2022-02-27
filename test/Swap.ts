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
  Crv,
  ConvexToken,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  UniswapV2Factory,
  UniswapV2Router02,
  CurveVoterProxy,
  Booster,
  RewardFactory,
  CvxStakingProxy,
} from '../typechain-types';

describe('Swap', () => {
  // Mocked Convex contracts
  let cvx: ConvexToken;
  let crv: Crv;

  // Seemingly invalid errors thrown for typechain types but they are correct
  let cvxCrvToken: any;
  let baseRewardPool: any;

  let curveVoterProxy: CurveVoterProxy;
  let booster: Booster;
  let rewardFactory: RewardFactory;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let cvxStakingProxy: CvxStakingProxy;
  let admin: SignerWithAddress;
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

    const PirexCvx = await ethers.getContractFactory('PirexCvx');

    // Mocked Convex contracts
    const Cvx = await ethers.getContractFactory('ConvexToken');
    const Crv = await ethers.getContractFactory('Crv');
    const CvxCrvToken = await ethers.getContractFactory('cvxCrvToken');
    const CurveVoterProxy = await ethers.getContractFactory('CurveVoterProxy');
    const Booster = await ethers.getContractFactory('Booster');
    const RewardFactory = await ethers.getContractFactory('RewardFactory');
    const BaseRewardPool = await ethers.getContractFactory(
      'contracts/mocks/BaseRewardPool.sol:BaseRewardPool'
    );
    const CvxLocker = await ethers.getContractFactory('CvxLocker');
    const CvxRewardPool = await ethers.getContractFactory('CvxRewardPool');
    const CvxStakingProxy = await ethers.getContractFactory('CvxStakingProxy');

    const SwapFactory = await ethers.getContractFactory('UniswapV2Factory');
    const SwapRouter = await ethers.getContractFactory('UniswapV2Router02');

    // Mocked Convex contracts
    curveVoterProxy = await CurveVoterProxy.deploy();
    cvx = await Cvx.deploy(curveVoterProxy.address);
    crv = await Crv.deploy();
    cvxCrvToken = await CvxCrvToken.deploy();
    booster = await Booster.deploy(curveVoterProxy.address, cvx.address);
    rewardFactory = await RewardFactory.deploy(booster.address);
    baseRewardPool = await BaseRewardPool.deploy(
      0,
      cvxCrvToken.address,
      crv.address,
      booster.address,
      rewardFactory.address
    );
    cvxLocker = await CvxLocker.deploy(
      cvx.address,
      cvxCrvToken.address,
      baseRewardPool.address
    );
    cvxRewardPool = await CvxRewardPool.deploy(
      cvx.address,
      crvAddr,
      crvDepositorAddr,
      cvxCrvRewardsAddr,
      cvxCrvTokenAddr,
      booster.address,
      admin.address
    );
    cvxLockerLockDuration = await cvxLocker.lockDuration();
    cvxStakingProxy = await CvxStakingProxy.deploy(
      cvxLocker.address,
      cvxRewardPool.address,
      crv.address,
      cvx.address,
      cvxCrvToken.address
    );
    pirexCvx = await PirexCvx.deploy(
      cvxLocker.address,
      cvx.address,
      cvxRewardPool.address,
      cvxDelegateRegistry,
      votiumMultiMerkleStash,
      initialEpochDepositDuration,
      cvxLockerLockDuration,
      admin.address,
      baseRewardPool.address,
      cvxCrvToken.address
    );
    swapFactory = await SwapFactory.deploy(admin.address);
    swapRouter = await SwapRouter.deploy(swapFactory.address, wethAddress);

    await cvxLocker.setStakingContract(cvxStakingProxy.address);
    await cvxLocker.setApprovals();
    await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
    await cvxStakingProxy.setApprovals();
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
      const [token0, token1] = orderPairTokens(
        wethAddress,
        firstLockedCvxAddress
      );

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

      await lockedCvxToken.approve(swapRouter.address, amountIn);

      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);
      const lockedBalanceBefore = await lockedCvxToken.balanceOf(admin.address);

      const tx = await swapRouter.swapExactTokensForETH(
        amountIn,
        amountOutMin,
        [firstLockedCvxAddress, wethAddress],
        admin.address,
        expiry
      );
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);

      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(admin.address);

      expect(lockedBalanceBefore.sub(lockedBalanceAfter)).to.be.eq(amountIn);
      expect(ethBalanceAfter.sub(ethBalanceBefore).add(gasUsed)).to.be.gte(
        amountOutMin
      );
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
      const lpBalanceToRemove = await lpBalanceBefore.div(2);
      const amount0 = 0;
      const amount1 = 0;

      await lpToken.approve(swapRouter.address, lpBalanceToRemove);

      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);
      const lockedBalanceBefore = await lockedCvxToken.balanceOf(admin.address);
      const getReserves = async () => {
        const [token0, token1] = await lpToken.getReserves();
        const token0Addr = await lpToken.token0();

        return wethAddress === token0Addr.toLowerCase()
          ? [token0, token1]
          : [token1, token0];
      };

      // Calculate expected returned tokens if we remove the liquidity
      const [lpTokenEthBalance, lpTokenLockedCvxBalance] = await getReserves();

      const lpTokenTotalSupply = await lpToken.totalSupply();
      const expectedEthAmount = lpBalanceToRemove
        .mul(lpTokenEthBalance)
        .div(lpTokenTotalSupply);
      const expectedLockedCvxAmount = lpBalanceToRemove
        .mul(lpTokenLockedCvxBalance)
        .div(lpTokenTotalSupply);
      const tx = await swapRouter.removeLiquidityETH(
        firstLockedCvxAddress,
        lpBalanceToRemove,
        amount0,
        amount1,
        admin.address,
        expiry
      );
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      const lpBalanceAfter = await lpToken.balanceOf(admin.address);
      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(admin.address);

      expect(lpBalanceBefore).to.be.eq(lpBalanceAfter.add(lpBalanceToRemove));
      expect(ethBalanceAfter).to.be.eq(
        ethBalanceBefore.add(expectedEthAmount).sub(gasUsed)
      );
      expect(lockedBalanceAfter).to.be.eq(
        lockedBalanceBefore.add(expectedLockedCvxAmount)
      );
    });
  });
});
