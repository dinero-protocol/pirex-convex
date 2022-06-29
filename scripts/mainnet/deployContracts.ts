import { ethers } from 'hardhat';
import {
  cvx,
  cvxLockerV2,
  convexDelegateRegistry,
  votiumMultiMerkleStash,
  redactedMultisig,
  unionDistributor,
  pirexMultisig,
  pxCvx as pxCvxAddress,
  spxCvx as spxCvxAddress,
  upxCvx as upxCvxAddress,
  vpxCvx as vpxCvxAddress,
  rpxCvx as rpxCvxAddress,
} from './constants';

async function main() {
  // Contract factories
  const PxCvx = await ethers.getContractFactory('PxCvx');
  const SpxCvx = await ethers.getContractFactory('ERC1155Solmate');
  const UpxCvx = await ethers.getContractFactory('ERC1155Solmate');
  const VpxCvx = await ethers.getContractFactory('ERC1155PresetMinterSupply');
  const RpxCvx = await ethers.getContractFactory('ERC1155PresetMinterSupply');
  const PirexFees = await ethers.getContractFactory('PirexFees');
  const PirexCvx = await ethers.getContractFactory('PirexCvx');
  const UnionPirexVault = await ethers.getContractFactory('UnionPirexVault');
  const UnionPirexStrategy = await ethers.getContractFactory(
    'UnionPirexStrategy'
  );

  // Deployments
  const pxCvx = await (await PxCvx.deploy()).deployed();
  const spxCvx = await (await SpxCvx.deploy()).deployed();
  const upxCvx = await (await UpxCvx.deploy()).deployed();
  const vpxCvx = await (await VpxCvx.deploy('')).deployed();
  const rpxCvx = await (await RpxCvx.deploy('')).deployed();
  const pirexFees = await PirexFees.deploy(redactedMultisig, pirexMultisig);
  const pirexCvx = await PirexCvx.deploy(
    cvx,
    cvxLockerV2,
    convexDelegateRegistry,
    pxCvxAddress,
    upxCvxAddress,
    spxCvxAddress,
    vpxCvxAddress,
    rpxCvxAddress,
    pirexFees.address,
    votiumMultiMerkleStash
  );
  const unionPirexVault = await UnionPirexVault.deploy(pxCvxAddress);
  const unionPirexStrategy = await UnionPirexStrategy.deploy(
    pirexCvx.address,
    pxCvxAddress,
    unionDistributor,
    unionPirexVault.address
  );

  console.log(`pxCvx: ${pxCvx.address}`);
  console.log(`spxCvx: ${spxCvx.address}`);
  console.log(`upxCvx: ${upxCvx.address}`);
  console.log(`vpxCvx: ${vpxCvx.address}`);
  console.log(`rpxCvx: ${rpxCvx.address}`);
  console.log(`pirexFees: ${pirexFees.address}`);
  console.log(`pirexCvx: ${pirexCvx.address}`);
  console.log(`unionPirexVault: ${unionPirexVault.address}`);
  console.log(`unionPirexStrategy: ${unionPirexStrategy.address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
