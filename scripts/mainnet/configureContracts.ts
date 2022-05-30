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

  // PxCvx
  await pxCvxContract.setOperator(pirexCvx);

  // PirexCvx - set fees
  await pirexCvxContract.setFee('0', '40000'); // Reward

  // NOTE: Needs to finish before setting RedemptionMin due to check
  await (await pirexCvxContract.setFee('1', '50000')).wait(1); // RedemptionMax

  await pirexCvxContract.setFee('2', '10000'); // RedemptionMin
  await pirexCvxContract.setFee('3', '5000'); // Developers

  // PirexCvx - set vault
  await pirexCvxContract.setContract('7', unionPirexVault);

  // Tokens - grant minter roles
  await spxCvxContract.grantMinterRole(pirexCvx);
  await upxCvxContract.grantMinterRole(pirexCvx);
  await vpxCvxContract.grantRole(await vpxCvxContract.MINTER_ROLE(), pirexCvx);
  await rpxCvxContract.grantRole(await rpxCvxContract.MINTER_ROLE(), pirexCvx);

  // Vault
  await unionPirexVaultContract.setPlatform(pirexMultisig);
  await unionPirexVaultContract.setStrategy(unionPirexStrategy);

  // PirexCvx - unpause contract
  await pirexCvxContract.setPauseState(false);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
