import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  increaseBlockTimestamp,
  toBN,
  callAndReturnEvents,
  impersonateAddressAndReturnSigner,
} from './helpers';
import {
  ConvexToken,
  CurveVoterProxy,
  RewardCvxVault,
  VaultControllerMock,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
  DelegateRegistry,
} from '../typechain-types';
import { BigNumber } from 'ethers';

describe('RewardCvxVault', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let vaultControllerSigner: SignerWithAddress;
  let vaultController: VaultControllerMock;
  let rewardCvxVault: RewardCvxVault;
  let cvx: ConvexToken;
  let crv: Crv;
  let cvxCrvToken: any;
  let baseRewardPool: any;
  let curveVoterProxy: CurveVoterProxy;
  let booster: Booster;
  let rewardFactory: RewardFactory;
  let cvxLocker: CvxLocker;
  let cvxLockDuration: BigNumber;
  let votiumMultiMerkleStash: any;
  let votiumAddressRegistry: any;
  let convexDelegateRegistry: DelegateRegistry;

  const epochDepositDuration = toBN(1209600); // 2 weeks in seconds
  const initialCvxBalanceForAdmin = toBN(100e18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';
  const rewardCvxId = 'rewardCVX';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const VaultController = await ethers.getContractFactory(
      'VaultControllerMock'
    );
    const RewardCvxVault = await ethers.getContractFactory('RewardCvxVault');
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
    const VotiumMultiMerkleStash: any = await ethers.getContractFactory(
      'MultiMerkleStash'
    );
    const VotiumAddressRegistry: any = await ethers.getContractFactory(
      'AddressRegistry'
    );
    const ConvexDelegateRegistry = await ethers.getContractFactory(
      'DelegateRegistry'
    );

    curveVoterProxy = await CurveVoterProxy.deploy();
    cvx = await Cvx.deploy(curveVoterProxy.address);
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
    cvxLockDuration = (await cvxLocker.lockDuration()).add(
      epochDepositDuration
    );
    votiumMultiMerkleStash = await VotiumMultiMerkleStash.deploy();
    votiumAddressRegistry = await VotiumAddressRegistry.deploy();
    convexDelegateRegistry = await ConvexDelegateRegistry.deploy();
    vaultController = await VaultController.deploy(
      cvx.address,
      cvxLocker.address,
      convexDelegateRegistry.address,
      votiumMultiMerkleStash.address,
      votiumAddressRegistry.address,
      epochDepositDuration,
      cvxLockDuration
    );
    rewardCvxVault = await RewardCvxVault.deploy();

    vaultControllerSigner = await impersonateAddressAndReturnSigner(
      admin,
      vaultController.address
    );

    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  describe('initialize', () => {
    it('Should revert if mintDeadline is zero', async () => {
      const invalidMintDeadline = 0;

      await expect(
        rewardCvxVault.initialize(
          vaultController.address,
          invalidMintDeadline,
          rewardCvxId,
          rewardCvxId
        )
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should set up contract state', async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const events = await callAndReturnEvents(rewardCvxVault.initialize, [
        vaultController.address,
        mintDeadline,
        rewardCvxId,
        rewardCvxId,
      ]);
      const initializeEvent = events[events.length - 1];
      const stateVaultController = await rewardCvxVault.vaultController();
      const stateMintDeadline = await rewardCvxVault.mintDeadline();

      expect(initializeEvent.eventSignature).to.equal(
        'Initialized(address,uint256)'
      );
      expect(stateVaultController)
        .to.equal(vaultController.address)
        .to.not.equal(zeroAddress);
      expect(initializeEvent.args._mintDeadline)
        .to.equal(mintDeadline)
        .to.equal(stateMintDeadline);
    });
  });

  describe('setRewardClaimer', () => {
    it('Should set rewardClaimer', async () => {
      const rewardClaimerBefore = await rewardCvxVault.rewardClaimer();
      const events = await callAndReturnEvents(
        rewardCvxVault.connect(vaultControllerSigner).setRewardClaimer,
        [admin.address]
      );
      const setEvent = events[events.length - 1];
      const rewardClaimerAfter = await rewardCvxVault.rewardClaimer();

      expect(rewardClaimerBefore).to.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetRewardClaimer(address)');
      expect(setEvent.args._rewardClaimer)
        .to.equal(rewardClaimerAfter)
        .to.equal(admin.address)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if not vaultController', async () => {
      await expect(
        rewardCvxVault.setRewardClaimer(admin.address)
      ).to.be.revertedWith('NotVaultController()');
    });

    it('Should revert if zero address', async () => {
      const invalidRewardClaimer = zeroAddress;

      await expect(
        rewardCvxVault
          .connect(vaultControllerSigner)
          .setRewardClaimer(invalidRewardClaimer)
      ).to.be.revertedWith('ZeroAddress()');
    });
  });

  describe('mint', () => {
    it('Should mint tokens', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const balanceBefore = await rewardCvxVault.balanceOf(to);
      const events = await callAndReturnEvents(
        rewardCvxVault.connect(vaultControllerSigner).mint,
        [to, amount]
      );
      const mintEvent = events[events.length - 1];
      const balanceAfter = await rewardCvxVault.balanceOf(to);
      const expectedBalance = balanceBefore.add(amount);

      expect(mintEvent.eventSignature).to.equal('Minted(address,uint256)');
      expect(mintEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintEvent.args.amount).to.equal(amount).to.not.equal(0);
      expect(balanceAfter).to.deep.equal(expectedBalance);
    });

    it('Should revert if not owner', async () => {
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        rewardCvxVault.connect(notAdmin).mint(to, amount)
      ).to.be.revertedWith('NotVaultController()');
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(
        rewardCvxVault.connect(vaultControllerSigner).mint(invalidTo, amount)
      ).to.be.revertedWith('ERC20: mint to the zero address');
    });

    it('Should revert if after mint deadline', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const mintDeadline = await rewardCvxVault.mintDeadline();
      const { timestamp } = await ethers.provider.getBlock('latest');
      const afterMintDeadline = mintDeadline.sub(timestamp).add(1);

      await increaseBlockTimestamp(Number(afterMintDeadline.toString()));

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );

      expect(mintDeadline.lt(timestampAfter)).to.equal(true);
      await expect(
        rewardCvxVault.connect(vaultControllerSigner).mint(to, amount)
      ).to.be.revertedWith('AfterMintDeadline');
    });
  });

  describe('addBribe', () => {
    it('Should revert if token is zero address', async () => {
      const invalidToken = zeroAddress;

      await expect(rewardCvxVault.addBribe(invalidToken)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should not add reward if zero token balance', async () => {
      const balance = await cvx.balanceOf(rewardCvxVault.address);
      const token = cvx.address;

      expect(balance).to.equal(0);
      await expect(rewardCvxVault.addBribe(token)).to.be.revertedWith(
        'ZeroBalance()'
      );
    });

    it('Should add bribe if non-zero token balance', async () => {
      const transferAmount = toBN(1e18);
      const balanceBefore = await cvx.balanceOf(rewardCvxVault.address);

      await cvx.transfer(rewardCvxVault.address, transferAmount);

      const balanceAfter = await cvx.balanceOf(rewardCvxVault.address);
      const token = cvx.address;
      const events = await callAndReturnEvents(rewardCvxVault.addBribe, [
        token,
      ]);
      const addEvent = events[events.length - 1];
      const bribe = await rewardCvxVault.bribes(0);

      expect(balanceAfter)
        .to.equal(balanceBefore.add(transferAmount))
        .to.not.equal(0);
      expect(addEvent.eventSignature).to.equal('AddedBribe(address,uint256)');
      expect(addEvent.args.token)
        .to.equal(token)
        .to.equal(bribe.token)
        .to.not.equal(zeroAddress);
      expect(addEvent.args.amount)
        .to.equal(transferAmount)
        .to.equal(bribe.amount)
        .to.not.equal(0);
    });
  });

  describe('redeemBribes', () => {
    let newRewardCvxVault: RewardCvxVault;

    before(async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const mintAmount = toBN(10e18);
      const transferAmount = toBN(10e18);

      newRewardCvxVault = await (
        await ethers.getContractFactory('RewardCvxVault')
      ).deploy();

      await cvx.transfer(newRewardCvxVault.address, transferAmount);
      await newRewardCvxVault.initialize(
        vaultController.address,
        mintDeadline,
        rewardCvxId,
        rewardCvxId
      );
      await newRewardCvxVault
        .connect(vaultControllerSigner)
        .mint(admin.address, mintAmount);
      await newRewardCvxVault
        .connect(vaultControllerSigner)
        .setRewardClaimer(admin.address);
      await newRewardCvxVault.addBribe(cvx.address);
    });

    it('Should revert if before mint deadline', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      const mintDeadline = await newRewardCvxVault.mintDeadline();
      const to = admin.address;
      const redeemAmount = toBN(1e18);

      expect(mintDeadline.gt(timestamp)).to.equal(true);
      await expect(
        newRewardCvxVault.redeemBribes(to, redeemAmount)
      ).to.be.revertedWith('BeforeMintDeadline()');
    });

    it('Should revert if to is zero address', async () => {
      const mintDeadline = await newRewardCvxVault.mintDeadline();
      const { timestamp } = await ethers.provider.getBlock('latest');
      const afterMintDeadline = mintDeadline.sub(timestamp).add(1);

      await increaseBlockTimestamp(Number(afterMintDeadline.toString()));

      const invalidTo = zeroAddress;
      const redeemAmount = toBN(1e18);

      await expect(
        newRewardCvxVault.redeemBribes(invalidTo, redeemAmount)
      ).to.be.revertedWith('ZeroAddress()');
    });

    it('Should revert if to is zero amount', async () => {
      const to = admin.address;
      const invalidRedeemAmount = 0;

      await expect(
        newRewardCvxVault.redeemBribes(to, invalidRedeemAmount)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should redeem bribes', async () => {
      const from = admin.address;
      const to = notAdmin.address;
      const redeemAmount = toBN(1e18);
      const balanceBefore = await cvx.balanceOf(notAdmin.address);
      const events = await callAndReturnEvents(newRewardCvxVault.redeemBribes, [
        to,
        redeemAmount,
      ]);
      const redeemEvent = events[events.length - 1];
      const balanceAfter = await cvx.balanceOf(notAdmin.address);
      const expectedWithdrawnTokens = [cvx.address];
      const expectedWithdrawnAmounts = [redeemAmount];

      expect(balanceAfter)
        .to.equal(balanceBefore.add(redeemAmount))
        .to.be.gt(0);
      expect(redeemEvent.eventSignature).to.equal(
        'Withdraw(address,address,address[],uint256[])'
      );
      expect(redeemEvent.args.from).to.equal(from).to.not.equal(zeroAddress);
      expect(redeemEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(redeemEvent.args.withdrawnTokens)
        .to.deep.equal(expectedWithdrawnTokens)
        .to.not.deep.equal([]);
      expect(redeemEvent.args.withdrawnAmounts)
        .to.deep.equal(expectedWithdrawnAmounts)
        .to.deep.equal([balanceAfter])
        .to.not.deep.equal([]);
    });
  });
});
