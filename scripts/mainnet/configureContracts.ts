import { ethers } from 'hardhat';
import {
  pxCvx,
  spxCvx,
  upxCvx,
  vpxCvx,
  rpxCvx,
  pirexCvx,
  unionPirexVault,
  unionPirexStrategy,
  pirexMultisig,
} from './constants';

async function main() {
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
  const pirexCvxContract = await ethers.getContractAt('PirexCvx', pirexCvx);
  const unionPirexVaultContract = await ethers.getContractAt(
    'UnionPirexVault',
    unionPirexVault
  );
  const MINTER_ROLE = await vpxCvxContract.MINTER_ROLE();

  // // PxCvx
  await (await pxCvxContract.setOperator(pirexCvx)).wait(1);

  // // PirexCvx - set fees
  await (await pirexCvxContract.setFee('0', '40000')).wait(1); // Reward

  // NOTE: Needs to finish before setting RedemptionMin due to check
  await (await pirexCvxContract.setFee('1', '50000')).wait(1); // RedemptionMax

  await (await pirexCvxContract.setFee('2', '10000')).wait(1); // RedemptionMin
  await (await pirexCvxContract.setFee('3', '5000')).wait(1); // Developers

  // PirexCvx - set vault
  await (await pirexCvxContract.setContract('7', unionPirexVault)).wait(1);

  // Tokens - grant minter roles
  await (await spxCvxContract.grantMinterRole(pirexCvx)).wait(1);
  await (await upxCvxContract.grantMinterRole(pirexCvx)).wait(1);
  await (await vpxCvxContract.grantRole(MINTER_ROLE, pirexCvx)).wait(1);
  await (await rpxCvxContract.grantRole(MINTER_ROLE, pirexCvx)).wait(1);

  // Vault
  await (await unionPirexVaultContract.setPlatform(pirexMultisig)).wait(1);
  await (await unionPirexVaultContract.setStrategy(unionPirexStrategy)).wait(1);

  // PirexCvx - unpause contract
  await pirexCvxContract.setPauseState(false);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
