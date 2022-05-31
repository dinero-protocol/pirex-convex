import { ethers } from 'hardhat';
import {
  pxCvx,
  spxCvx,
  upxCvx,
  vpxCvx,
  rpxCvx,
  pirexFees,
  pirexCvx,
  unionPirexVault,
  unionPirexStrategy,
  pirexMultisig,
} from './constants';

async function main() {
  const [deployer] = await ethers.getSigners();

  // Contract instances
  const pxCvxContract = await ethers.getContractAt('PxCvx', pxCvx);
  const spxCvxContract = await ethers.getContractAt('ERC1155Solmate', spxCvx);
  const upxCvxContract = await ethers.getContractAt('ERC1155Solmate', upxCvx);
  const vpxCvxContract = await ethers.getContractAt(
    'ERC1155PresetMinterSupply',
    vpxCvx
  );
  const rpxCvxContract = await ethers.getContractAt(
    'ERC1155PresetMinterSupply',
    rpxCvx
  );
  const pirexFeesContract = await ethers.getContractAt('PirexFees', pirexFees);
  const pirexCvxContract = await ethers.getContractAt('PirexCvx', pirexCvx);
  const unionPirexVaultContract = await ethers.getContractAt(
    'UnionPirexVault',
    unionPirexVault
  );
  const unionPirexStrategyContract = await ethers.getContractAt(
    'UnionPirexStrategy',
    unionPirexStrategy
  );
  const DEFAULT_ADMIN_ROLE = await spxCvxContract.DEFAULT_ADMIN_ROLE();
  const MINTER_ROLE = await spxCvxContract.MINTER_ROLE();

  // Ownable-based
  await (await pxCvxContract.transferOwnership(pirexMultisig)).wait(1);
  await (await pirexFeesContract.transferOwnership(pirexMultisig)).wait(1);
  await (await pirexCvxContract.transferOwnership(pirexMultisig)).wait(1);
  await (await unionPirexVaultContract.transferOwnership(pirexMultisig)).wait(1);
  await (await unionPirexStrategyContract.transferOwnership(pirexMultisig)).wait(1);

  // AccessControl-based - ERC1155Solmate contracts
  await (
    await spxCvxContract.grantRole(DEFAULT_ADMIN_ROLE, pirexMultisig)
  ).wait(1);
  await (await spxCvxContract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait(1);
  await (
    await upxCvxContract.grantRole(DEFAULT_ADMIN_ROLE, pirexMultisig)
  ).wait(1);
  await (await spxCvxContract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait(1);

  // AccessControl-based - ERC1155PresetMinterSupply contracts
  await (
    await vpxCvxContract.renounceRole(MINTER_ROLE, deployer.address)
  ).wait(1);
  await (
    await vpxCvxContract.grantRole(DEFAULT_ADMIN_ROLE, pirexMultisig)
  ).wait(1);
  await (await vpxCvxContract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait(1);
  await (
    await rpxCvxContract.renounceRole(MINTER_ROLE, deployer.address)
  ).wait(1);
  await (
    await rpxCvxContract.grantRole(DEFAULT_ADMIN_ROLE, pirexMultisig)
  ).wait(1);
  await (await rpxCvxContract.renounceRole(DEFAULT_ADMIN_ROLE, deployer.address)).wait(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
