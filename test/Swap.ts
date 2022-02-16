import { expect } from "chai";
import { keccak256 } from "@ethersproject/solidity";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Promise } from "bluebird";
import {
  callAndReturnEvent,
  increaseBlockTimestamp,
  convertBigNumberToNumber,
  toBN,
} from "./helpers";
import { BigNumber } from "ethers";
import {
  Cvx,
  CvxLocker,
  CvxRewardPool,
  PirexCvx,
  UniswapV2Factory,
  UniswapV2Router02,
} from "../typechain-types";

describe.only("PirexCvx", () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let cvx: Cvx;
  let cvxLocker: CvxLocker;
  let cvxRewardPool: CvxRewardPool;
  let pirexCvx: PirexCvx;
  let cvxLockerLockDuration: BigNumber;
  let firstDepositEpoch: BigNumber;
  let firstVoteEpoch: BigNumber;
  let swapFactory: UniswapV2Factory;
  let swapRouter: UniswapV2Router02;
  let firstPairAddress: string;
  let firstLockedCvxAddress: string;

  const crvAddr = "0xd533a949740bb3306d119cc777fa900ba034cd52";
  const crvDepositorAddr = "0x8014595F2AB54cD7c604B00E9fb932176fDc86Ae";
  const cvxCrvRewardsAddr = "0x3Fe65692bfCD0e6CF84cB1E7d24108E434A7587e";
  const cvxCrvTokenAddr = "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7";
  const cvxDelegateRegistry = "0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446";
  const votiumMultiMerkleStash = "0x378Ba9B73309bE80BF4C2c027aAD799766a7ED5A";
  const initialCvxBalanceForAdmin = toBN(10e18);
  const initialEpochDepositDuration = 1209600; // 2 weeks in seconds
  const defaultSpendRatio = 0;
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  const lockedCvxPrefix = "lockedCVX";
  const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const CVX = await ethers.getContractFactory("Cvx");
    const CVXLocker = await ethers.getContractFactory("CvxLocker");
    const CVXRewardPool = await ethers.getContractFactory("CvxRewardPool");
    const PirexCVX = await ethers.getContractFactory("PirexCvx");
    const SwapFactory = await ethers.getContractFactory("UniswapV2Factory");
    const SwapRouter = await ethers.getContractFactory("UniswapV2Router02");

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
      "0xe096ccec4a1d36f191189fe61e803d8b2044dfc3"
    );
    await cvxLocker.setApprovals();
    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  const getPirexCvxToken = async (address: string) =>
    await ethers.getContractAt("ERC20PresetMinterPauserUpgradeable", address);

  describe("createPair", () => {
    it("Should create pair for new pair of distinct tokens", async () => {
      // Simulate Pirex deposit to trigger all the cvx token creations
      const epochDepositDuration = convertBigNumberToNumber(
        await pirexCvx.epochDepositDuration()
      );
      const depositAmount = toBN(5e18);

      await cvx.approve(pirexCvx.address, depositAmount);

      firstDepositEpoch = await pirexCvx.getCurrentEpoch();

      const depositEvent = await callAndReturnEvent(pirexCvx.deposit, [
        depositAmount,
        defaultSpendRatio,
      ]);
      const rewardsDuration = convertBigNumberToNumber(
        await cvxLocker.rewardsDuration()
      );

      // Convex does not reflect actual locked CVX until their next epoch (1 week)
      await increaseBlockTimestamp(rewardsDuration);

      // Store to test withdrawing tokens for this specific epoch later
      const pirexCvxToken = await getPirexCvxToken(depositEvent.args.token);
      firstLockedCvxAddress = pirexCvxToken.address;
      const expectedVoteEpochs = [...Array(8).keys()].map((_, idx) =>
        toBN(
          convertBigNumberToNumber(firstDepositEpoch) +
            epochDepositDuration * (idx + 1)
        )
      );

      firstVoteEpoch = expectedVoteEpochs[0];

      // Attempt to create the WETH/lockedCVX pair
      const createPairEvent = await callAndReturnEvent(swapFactory.createPair, [
        wethAddress,
        pirexCvxToken.address,
      ]);
      firstPairAddress = createPairEvent.args.pair;
      const token0 = (wethAddress < pirexCvxToken.address
        ? wethAddress
        : pirexCvxToken.address
      ).toLowerCase();
      const token1 = (wethAddress < pirexCvxToken.address
        ? pirexCvxToken.address
        : wethAddress
      ).toLowerCase();

      expect(createPairEvent.eventSignature).to.equal(
        "PairCreated(address,address,address,uint256)"
      );
      expect(createPairEvent.args.token0.toLowerCase()).to.be.oneOf([
        token0,
        token1,
      ]);
      expect(createPairEvent.args.token1.toLowerCase()).to.be.oneOf([
        token0,
        token1,
      ]);
      expect(createPairEvent.args.token1.toLowerCase()).to.not.equal(
        createPairEvent.args.token0.toLowerCase()
      );
      expect(createPairEvent.args.pair).to.not.equal(zeroAddress);
    });

    it("Should not create pair for existing pair of distinct tokens", async () => {
      await expect(
        swapFactory.createPair(firstLockedCvxAddress, wethAddress)
      ).to.be.revertedWith("UniswapV2: PAIR_EXISTS");
    });

    it("Should not create pair for identical tokens", async () => {
      await expect(
        swapFactory.createPair(firstLockedCvxAddress, firstLockedCvxAddress)
      ).to.be.revertedWith("UniswapV2: IDENTICAL_ADDRESSES");
    });
  });

  describe("addLiquidity", () => {
    it("Should add liquidity for valid pair", async () => {
      const amount0 = toBN(1e17);
      const amount1 = toBN(1e18);
      const { timestamp } = await ethers.provider.getBlock("latest");
      const expiry = timestamp + 60;
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      const lpToken = await ethers.getContractAt(
        "UniswapV2Pair",
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

  describe("swapExactTokensForETH", () => {
    it("Should swap exact amount of tokens for ETH", async () => {
      const amountIn = toBN(1e17);
      const lockedCvxToken = await getPirexCvxToken(firstLockedCvxAddress);
      await lockedCvxToken.transfer(notAdmin.address, amountIn);
      const { timestamp } = await ethers.provider.getBlock("latest");
      const expiry = timestamp + 60;
      const quotes = await swapRouter.getAmountsOut(amountIn, [firstLockedCvxAddress, wethAddress]);
      const slippage = 1; // 1%
      const amountOutMin = quotes[quotes.length - 1].sub(quotes[quotes.length - 1].mul(slippage).div(100));

      await lockedCvxToken.connect(notAdmin).approve(swapRouter.address, amountIn);

      const ethBalanceBefore = await ethers.provider.getBalance(admin.address);

      await swapRouter
        .connect(notAdmin)
        .swapExactTokensForETH(
          amountIn,
          amountOutMin,
          [firstLockedCvxAddress, wethAddress],
          admin.address,
          expiry
        );

      const ethBalanceAfter = await ethers.provider.getBalance(admin.address);
      const lockedBalanceAfter = await lockedCvxToken.balanceOf(notAdmin.address);

      expect(lockedBalanceAfter).to.be.eq(0);
      expect(ethBalanceAfter.sub(ethBalanceBefore)).to.be.gte(amountOutMin);
    });
  });
});
