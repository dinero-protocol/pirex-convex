import { ethers } from 'hardhat';
import { contracts } from './constants';
import { toBN, increaseBlockTimestamp } from '../../test/helpers';
import { BalanceTree } from '../../lib/merkle';

async function main() {
  const [admin] = await ethers.getSigners();
  const { address: adminAddress } = admin;
  const cvx = await ethers.getContractAt('ConvexToken', contracts.cvx);
  const pirexCvx = await ethers.getContractAt('PirexCvx', contracts.pirexCvx);
  const pxCvx = await ethers.getContractAt('PxCvx', contracts.pxCvx);
  const cvxLocker = await ethers.getContractAt(
    'CvxLockerV2',
    contracts.cvxLocker
  );
  const crv = await ethers.getContractAt('Crv', contracts.crv);
  const cvxCrv = await ethers.getContractAt('cvxCrvToken', contracts.cvxCrv);
  const votium = await ethers.getContractAt(
    'MultiMerkleStash',
    contracts.votium
  );

  // Amount of CVX to mint and deposit
  const assets = toBN(1);

  // Account receiving CVX
  const receiver = adminAddress;

  // Whether or not to compound
  const shouldCompound = true;

  // Account receiving developer incentives (ignore)
  const developer = ethers.constants.AddressZero;

  // Whether or not to lock CVX with CvxLocker
  const lock = true;

  // Amount of reward tokens
  const rewards = toBN(1);

  console.log(`Admin CVX balance before: ${await cvx.balanceOf(adminAddress)}`);
  console.log(
    `Receiver pxCVX balance before: ${await pxCvx.balanceOf(receiver)}`
  );
  console.log(
    `PirexCvx locked balance before: ${await cvxLocker.lockedBalances(
      pirexCvx.address
    )}`
  );

  await cvx.mint(adminAddress, assets);
  await cvx.approve(pirexCvx.address, await cvx.balanceOf(adminAddress));
  await pirexCvx.deposit(assets, receiver, shouldCompound, developer);

  if (lock) {
    await pirexCvx.lock();
  }

  console.log(`Admin CVX balance after: ${await cvx.balanceOf(adminAddress)}`);
  console.log(
    `Receiver pxCVX balance after: ${await pxCvx.balanceOf(receiver)}`
  );
  console.log(
    `PirexCvx locked balance after: ${await cvxLocker.lockedBalances(
      pirexCvx.address
    )}`
  );

  const merkleTree = new BalanceTree([
    {
      account: pirexCvx.address,
      amount: rewards,
    },
  ]);

  console.log(
    'epochBefore',
    await pxCvx.getEpoch(await pirexCvx.getCurrentEpoch())
  );

  // Mint reward tokens
  await cvx.mint(votium.address, rewards);
  await crv.mint(votium.address, rewards);
  await cvxCrv.mint(votium.address, rewards);
  await votium.updateMerkleRoot(cvx.address, merkleTree.getHexRoot());
  await votium.updateMerkleRoot(crv.address, merkleTree.getHexRoot());
  await votium.updateMerkleRoot(cvxCrv.address, merkleTree.getHexRoot());
  await increaseBlockTimestamp(await pirexCvx.EPOCH_DURATION());
  await pirexCvx.claimVotiumRewards([
    {
      token: cvx.address,
      index: 0,
      amount: rewards,
      merkleProof: [],
    },
    {
      token: crv.address,
      index: 0,
      amount: rewards,
      merkleProof: [],
    },
    {
      token: cvxCrv.address,
      index: 0,
      amount: rewards,
      merkleProof: [],
    },
  ]);

  console.log(
    'epochAfter',
    await pxCvx.getEpoch(await pirexCvx.getCurrentEpoch())
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
