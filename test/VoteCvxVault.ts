import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { increaseBlockTimestamp, toBN, callAndReturnEvents } from './helpers';
import { ConvexToken, CurveVoterProxy, TriCvxVault } from '../typechain-types';

describe('TriCvxVault', () => {
  let admin: SignerWithAddress;
  let notAdmin: SignerWithAddress;
  let triCvxVault: TriCvxVault;
  let curveVoterProxy: CurveVoterProxy;
  let cvx: ConvexToken;

  const initialCvxBalanceForAdmin = toBN(100e18);
  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    [admin, notAdmin] = await ethers.getSigners();

    const CurveVoterProxy = await ethers.getContractFactory('CurveVoterProxy');
    const Cvx = await ethers.getContractFactory('ConvexToken');
    const TriCvxVault = await ethers.getContractFactory('TriCvxVault');

    curveVoterProxy = await CurveVoterProxy.deploy();
    cvx = await Cvx.deploy(curveVoterProxy.address);
    triCvxVault = await TriCvxVault.deploy();

    await cvx.mint(admin.address, initialCvxBalanceForAdmin);
  });

  describe('initialize', () => {
    it('Should revert if mintDeadline is zero', async () => {
      const invalidMintDeadline = 0;

      await expect(
        triCvxVault.initialize(invalidMintDeadline)
      ).to.be.revertedWith('ZeroAmount()');
    });

    it('Should set up contract state', async () => {
      const mintDeadline =
        (await ethers.provider.getBlock('latest')).timestamp + 86400;
      const events = await callAndReturnEvents(triCvxVault.initialize, [
        mintDeadline,
      ]);
      const initializeEvent = events[events.length - 1];
      const stateOwner = await triCvxVault.owner();
      const stateMintDeadline = await triCvxVault.mintDeadline();

      expect(initializeEvent.eventSignature).to.equal('Initialized(uint256)');
      expect(stateOwner).to.equal(admin.address).to.not.equal(zeroAddress);
      expect(initializeEvent.args._mintDeadline)
        .to.equal(mintDeadline)
        .to.equal(stateMintDeadline);
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
      const events = await callAndReturnEvents(triCvxVault.mint, [to, amount]);
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
      ).to.be.revertedWith('Caller is not the owner');
    });

    it('Should revert if to is zero address', async () => {
      const invalidTo = zeroAddress;
      const amount = toBN(1e18);

      await expect(triCvxVault.mint(invalidTo, amount)).to.be.revertedWith(
        'ERC1155: mint to the zero address'
      );
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
      await expect(triCvxVault.mint(to, amount)).to.be.revertedWith(
        'AfterMintDeadline'
      );
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
