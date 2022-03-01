import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Promise } from 'bluebird';
import {
  increaseBlockTimestamp,
  toBN,
  callAndReturnEvents,
  getNumberBetweenRange,
} from './helpers';
import { ConvexToken, CurveVoterProxy, VoteCvxVault } from '../typechain-types';

describe('VoteCvxVault', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let voteCvxVault: VoteCvxVault;
  let curveVoterProxy: CurveVoterProxy;
  let cvx: ConvexToken;

  const initialCvxBalanceForAdmin = toBN(100e18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const CurveVoterProxy = await ethers.getContractFactory('CurveVoterProxy');
    const Cvx = await ethers.getContractFactory('ConvexToken');
    const VoteCvxVault = await ethers.getContractFactory('VoteCvxVault');

    curveVoterProxy = await CurveVoterProxy.deploy();
    cvx = await Cvx.deploy(curveVoterProxy.address);
    voteCvxVault = await VoteCvxVault.deploy();

    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  describe('initialize', () => {
    it('Should revert if mintDeadline is zero', async () => {
      const invalidMintDeadline = 0;
      const tokenId = 'voteCVX';

      await expect(
        voteCvxVault.initialize(invalidMintDeadline, tokenId, tokenId)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should revert if tokenId is an empty string', async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const invalidTokenId = '';

      await expect(
        voteCvxVault.initialize(mintDeadline, invalidTokenId, invalidTokenId)
      ).to.be.revertedWith('EmptyString()');
    });

    it('Should set up contract state', async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const tokenId = 'voteCVX';

      const events = await callAndReturnEvents(voteCvxVault.initialize, [
        mintDeadline,
        tokenId,
        tokenId,
      ]);
      const initializeEvent = events[events.length - 1];
      const stateOwner = await voteCvxVault.owner();
      const stateMintDeadline = await voteCvxVault.mintDeadline();
      const stateName = await voteCvxVault.name();
      const stateSymbol = await voteCvxVault.symbol();

      expect(initializeEvent.eventSignature).to.equal(
        'Initialized(uint256,string,string)'
      );
      expect(stateOwner).to.equal(admin.address).to.not.equal(zeroAddress);
      expect(initializeEvent.args._mintDeadline)
        .to.equal(mintDeadline)
        .to.equal(stateMintDeadline);
      expect(initializeEvent.args._name).to.equal(tokenId).to.equal(stateName);
      expect(initializeEvent.args._symbol)
        .to.equal(tokenId)
        .to.equal(stateSymbol);
    });
  });

  describe('mint', () => {
    it('Should mint tokens', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const balanceBefore = await voteCvxVault.balanceOf(to);
      const events = await callAndReturnEvents(voteCvxVault.mint, [to, amount]);
      const mintEvent = events[events.length - 1];
      const balanceAfter = await voteCvxVault.balanceOf(to);

      expect(mintEvent.eventSignature).to.equal('Minted(address,uint256)');
      expect(mintEvent.args.to).to.equal(to).to.not.equal(zeroAddress);
      expect(mintEvent.args.amount).to.equal(amount).to.not.equal(0);
      expect(balanceAfter).to.equal(balanceBefore.add(amount)).to.not.equal(0);
    });

    it('Should revert if not owner', async () => {
      const to = admin.address;
      const amount = toBN(1e18);

      await expect(
        voteCvxVault.connect(notAdmin).mint(to, amount)
      ).to.be.revertedWith('Caller is not the owner');
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(voteCvxVault.mint(invalidTo, amount)).to.be.revertedWith(
        'ERC20: mint to the zero address'
      );
    });

    it('Should revert if after mint deadline', async () => {
      const to = admin.address;
      const amount = toBN(1e18);
      const mintDeadline = await voteCvxVault.mintDeadline();
      const { timestamp } = await ethers.provider.getBlock('latest');
      const afterMintDeadline = mintDeadline.sub(timestamp).add(1);

      await increaseBlockTimestamp(Number(afterMintDeadline.toString()));

      const { timestamp: timestampAfter } = await ethers.provider.getBlock(
        'latest'
      );

      expect(mintDeadline.lt(timestampAfter)).to.equal(true);
      await expect(voteCvxVault.mint(to, amount)).to.be.revertedWith(
        'AfterMintDeadline'
      );
    });
  });

  describe('addReward', () => {
    it('Should revert if token is zero address', async () => {
      const invalidToken = zeroAddress;

      await expect(voteCvxVault.addReward(invalidToken)).to.be.revertedWith(
        'ZeroAddress()'
      );
    });

    it('Should not add reward if zero token balance', async () => {
      const balance = await cvx.balanceOf(voteCvxVault.address);
      const token = cvx.address;

      expect(balance).to.equal(0);
      await expect(voteCvxVault.addReward(token)).to.be.revertedWith(
        'ZeroBalance()'
      );
    });

    it('Should add reward if non-zero token balance', async () => {
      const transferAmount = toBN(1e18);
      const balanceBefore = await cvx.balanceOf(voteCvxVault.address);

      await cvx.transfer(voteCvxVault.address, transferAmount);

      const balanceAfter = await cvx.balanceOf(voteCvxVault.address);
      const token = cvx.address;
      const events = await callAndReturnEvents(voteCvxVault.addReward, [token]);
      const addEvent = events[events.length - 1];
      const reward = await voteCvxVault.rewards(0);

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
