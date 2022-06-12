import { ethers } from 'hardhat';
import { toBN } from '../../test/helpers';

async function main() {
  const [admin] = await ethers.getSigners();
  const frontendAccount = '0x252537940740629ae6c83f6c5f1459c2f8f6eb3e';
  const initialBalance = toBN(100e18);

  // Deploy base contracts
  const curveVoterProxy = await (
    await ethers.getContractFactory('CurveVoterProxy')
  ).deploy();
  const cvx = await (
    await ethers.getContractFactory('ConvexToken')
  ).deploy(curveVoterProxy.address);
  const crv = await (await ethers.getContractFactory('Crv')).deploy();
  const cvxCrvToken = await (
    await ethers.getContractFactory('cvxCrvToken')
  ).deploy();
  const crvDepositor = await (
    await ethers.getContractFactory('CrvDepositor')
  ).deploy(curveVoterProxy.address, cvxCrvToken.address);
  const booster = await (
    await ethers.getContractFactory('Booster')
  ).deploy(curveVoterProxy.address, cvx.address);
  const rewardFactory = await (
    await ethers.getContractFactory('RewardFactory')
  ).deploy(booster.address);
  const baseRewardPool = await (
    await ethers.getContractFactory(
      'contracts/mocks/BaseRewardPool.sol:BaseRewardPool'
    )
  ).deploy(
    0,
    cvxCrvToken.address,
    crv.address,
    booster.address,
    rewardFactory.address
  );
  const cvxLocker = await (
    await ethers.getContractFactory('CvxLockerV2')
  ).deploy(cvx.address, cvxCrvToken.address, baseRewardPool.address);
  const cvxRewardPool = await (
    await ethers.getContractFactory('CvxRewardPool')
  ).deploy(
    cvx.address,
    crv.address,
    crvDepositor.address,
    baseRewardPool.address,
    cvxCrvToken.address,
    booster.address,
    admin.address
  );
  const cvxStakingProxy = await (
    await ethers.getContractFactory('CvxStakingProxy')
  ).deploy(
    cvxLocker.address,
    cvxRewardPool.address,
    crv.address,
    cvx.address,
    cvxCrvToken.address
  );

  // Workaround for Typescript not acknowledging deploy method
  const v: any = await ethers.getContractFactory('MultiMerkleStash');
  const votiumMultiMerkleStash = await v.deploy();
  const cvxDelegateRegistry = await (
    await ethers.getContractFactory('DelegateRegistry')
  ).deploy();

  // Log addresses (update pirex-ui if necessary)
  console.log(`cvx: '${cvx.address}',`);
  console.log(`crv: '${crv.address}',`);
  console.log(`cvxCrv: '${cvxCrvToken.address}',`);
  console.log(`cvxLocker: '${cvxLocker.address}',`);
  console.log(`votium: '${votiumMultiMerkleStash.address}',`);

  // Configurations

  await cvxLocker.setStakingContract(cvxStakingProxy.address);
  await cvxLocker.setApprovals();
  await cvxLocker.addReward(crv.address, admin.address, true);
  await cvxLocker.addReward(cvxCrvToken.address, admin.address, true);
  await cvxStakingProxy.setApprovals();
  await cvx.mint(admin.address, initialBalance);
  await crv.mint(admin.address, initialBalance);
  await cvxCrvToken.mint(admin.address, initialBalance);
  await cvx.mint(frontendAccount, initialBalance);
  await crv.mint(frontendAccount, initialBalance);
  await cvxCrvToken.mint(frontendAccount, initialBalance);

  const pxCvx = await (await ethers.getContractFactory('PxCvx')).deploy();
  const pirexFees = await (
    await ethers.getContractFactory('PirexFees')
  ).deploy(admin.address, admin.address);
  const upxCvx = await (
    await ethers.getContractFactory('ERC1155Solmate')
  ).deploy();
  const spxCvx = await (
    await ethers.getContractFactory('ERC1155Solmate')
  ).deploy();
  const vpxCvx = await (
    await ethers.getContractFactory('ERC1155PresetMinterSupply')
  ).deploy('');
  const rpxCvx = await (
    await ethers.getContractFactory('ERC1155PresetMinterSupply')
  ).deploy('');
  const pirexCvx = await (
    await ethers.getContractFactory('PirexCvx')
  ).deploy(
    cvx.address,
    cvxLocker.address,
    cvxDelegateRegistry.address,
    pxCvx.address,
    upxCvx.address,
    spxCvx.address,
    vpxCvx.address,
    rpxCvx.address,
    pirexFees.address,
    votiumMultiMerkleStash.address
  );
  const unionPirex = await (
    await ethers.getContractFactory('UnionPirexVault')
  ).deploy(pxCvx.address);
  const unionPirexStrategy = await (
    await ethers.getContractFactory('UnionPirexStrategy')
  ).deploy(pirexCvx.address, pxCvx.address, admin.address, unionPirex.address);
  const minterRole = await vpxCvx.MINTER_ROLE();

  // Log addresses (update pirex-ui if necessary)
  console.log(`pxCvx: '${pxCvx.address}',`);
  console.log(`upxCvx: '${upxCvx.address}',`);
  console.log(`spxCvx: '${spxCvx.address}',`);
  console.log(`rpxCvx: '${rpxCvx.address}',`);
  console.log(`vpxCvx: '${vpxCvx.address}',`);
  console.log(`pirexCvx: '${pirexCvx.address}',`);
  console.log(`unionPirex: '${unionPirex.address}',`);
  console.log(`unionPirexStrategy: '${unionPirexStrategy.address}',`);

  await pxCvx.setOperator(pirexCvx.address);
  await pirexCvx.setFee(0, 40000);
  await pirexCvx.setFee(1, 50000);
  await pirexCvx.setFee(2, 10000);
  await pirexCvx.setFee(3, 5000);
  await pirexCvx.setContract(7, unionPirex.address);
  await upxCvx.grantRole(minterRole, pirexCvx.address);
  await spxCvx.grantRole(minterRole, pirexCvx.address);
  await vpxCvx.grantRole(minterRole, pirexCvx.address);
  await rpxCvx.grantRole(minterRole, pirexCvx.address);
  await unionPirex.setPlatform(admin.address);
  await unionPirex.setStrategy(unionPirexStrategy.address);
  await pirexCvx.setPauseState(false);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
