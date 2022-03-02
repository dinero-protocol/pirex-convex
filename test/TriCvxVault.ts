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
  TriCvxVault,
  VaultControllerMock,
  Crv,
  Booster,
  RewardFactory,
  CvxLocker,
} from '../typechain-types';
import { BigNumber } from 'ethers';

describe('TriCvxVault', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let vaultControllerSigner: SignerWithAddress;
  let vaultController: VaultControllerMock;
  let triCvxVault: TriCvxVault;
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

  const epochDepositDuration = toBN(1209600); // 2 weeks in seconds
  const initialCvxBalanceForAdmin = toBN(100e18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const VaultController = await ethers.getContractFactory(
      'VaultControllerMock'
    );
    const TriCvxVault = await ethers.getContractFactory('TriCvxVault');
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
    vaultController = await VaultController.deploy(
      cvx.address,
      cvxLocker.address,
      votiumMultiMerkleStash.address,
      votiumAddressRegistry.address,
      epochDepositDuration,
      cvxLockDuration
    );
    triCvxVault = await TriCvxVault.deploy();

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
        triCvxVault.initialize(vaultController.address, invalidMintDeadline)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should set up contract state', async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const events = await callAndReturnEvents(triCvxVault.initialize, [
        vaultController.address,
        mintDeadline,
      ]);
      const initializeEvent = events[events.length - 1];
      const stateVaultController = await triCvxVault.vaultController();
      const stateMintDeadline = await triCvxVault.mintDeadline();

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
      const rewardClaimerBefore = await triCvxVault.rewardClaimer();
      const events = await callAndReturnEvents(
        triCvxVault.connect(vaultControllerSigner).setRewardClaimer,
        [admin.address]
      );
      const setEvent = events[events.length - 1];
      const rewardClaimerAfter = await triCvxVault.rewardClaimer();

      expect(rewardClaimerBefore).to.equal(zeroAddress);
      expect(setEvent.eventSignature).to.equal('SetRewardClaimer(address)');
      expect(setEvent.args._rewardClaimer)
        .to.equal(rewardClaimerAfter)
        .to.equal(admin.address)
        .to.not.equal(zeroAddress);
    });

    it('Should revert if not vaultController', async () => {
      await expect(
        triCvxVault.setRewardClaimer(admin.address)
      ).to.be.revertedWith('NotVaultController()');
    });

    it('Should revert if zero address', async () => {
      const invalidRewardClaimer = zeroAddress;

      await expect(
        triCvxVault
          .connect(vaultControllerSigner)
          .setRewardClaimer(invalidRewardClaimer)
      ).to.be.revertedWith('ZeroAddress()');
    });
  });

  describe('mint', () => {
    it('Should mint tokens', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const balanceBefore = {
        voteCvx: await triCvxVault.balanceOf(to, 0),
        bribeCvx: await triCvxVault.balanceOf(to, 1),
        rewardCvx: await triCvxVault.balanceOf(to, 2),
      };
      const events = await callAndReturnEvents(
        triCvxVault.connect(vaultControllerSigner).mint,
        [to, amount]
      );
      const mintEvent = events[events.length - 1];
      const balanceAfter = {
        voteCvx: await triCvxVault.balanceOf(to, 0),
        bribeCvx: await triCvxVault.balanceOf(to, 1),
        rewardCvx: await triCvxVault.balanceOf(to, 2),
      };
      const expectedBalance = {
        voteCvx: balanceBefore.voteCvx.add(amount),
        bribeCvx: balanceBefore.bribeCvx.add(amount),
        rewardCvx: balanceBefore.rewardCvx.add(amount),
      };

      expect(mintEvent.eventSignature).to.equal('Minted(address,uint256)');
      expect(mintEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintEvent.args.amount).to.equal(amount).to.not.equal(0);
      expect(balanceAfter).to.deep.equal(expectedBalance);
    });

    it('Should revert if not owner', async () => {
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        triCvxVault.connect(notAdmin).mint(to, amount)
      ).to.be.revertedWith('NotVaultController()');
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(
        triCvxVault.connect(vaultControllerSigner).mint(invalidTo, amount)
      ).to.be.revertedWith('ERC1155: mint to the zero address');
    });

    it('Should revert if after mint deadline', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const mintDeadline = await triCvxVault.mintDeadline();
      const { timestamp } = await ethers.provider.getBlock('latest');
      const afterMintDeadline = mintDeadline.sub(timestamp).add(1);

      await increaseBlockTimestamp(Number(afterMintDeadline.toString()));

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );

      expect(mintDeadline.lt(timestampAfter)).to.equal(true);
      await expect(
        triCvxVault.connect(vaultControllerSigner).mint(to, amount)
      ).to.be.revertedWith('AfterMintDeadline');
    });
  });

  describe('addReward', () => {
    it('Should revert if token is zero address', async () => {
      const invalidToken = zeroAddress;

      await expect(triCvxVault.addReward(invalidToken)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should not add reward if zero token balance', async () => {
      const balance = await cvx.balanceOf(triCvxVault.address);
      const token = cvx.address;

      expect(balance).to.equal(0);
      await expect(triCvxVault.addReward(token)).to.be.revertedWith(
        'ZeroBalance()'
      );
    });

    it('Should add reward if non-zero token balance', async () => {
      const transferAmount = toBN(1e18);
      const balanceBefore = await cvx.balanceOf(triCvxVault.address);

      await cvx.transfer(triCvxVault.address, transferAmount);

      const balanceAfter = await cvx.balanceOf(triCvxVault.address);
      const token = cvx.address;
      const events = await callAndReturnEvents(triCvxVault.addReward, [token]);
      const addEvent = events[events.length - 1];
      const reward = await triCvxVault.rewards(0);

      expect(balanceAfter)
        .to.equal(balanceBefore.add(transferAmount))
        .to.not.equal(0);
      expect(addEvent.eventSignature).to.equal('AddedReward(address,uint256)');
      expect(addEvent.args.token)
        .to.equal(token)
        .to.equal(reward.token)
        .to.not.equal(zeroAddress);
      expect(addEvent.args.amount)
        .to.equal(transferAmount)
        .to.equal(reward.amount)
        .to.not.equal(0);
    });
  });
});
