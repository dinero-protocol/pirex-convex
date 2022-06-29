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
  const MINTER_ROLE = await spxCvxContract.MINTER_ROLE();
  const DEFAULT_ADMIN_ROLE = await spxCvxContract.DEFAULT_ADMIN_ROLE();

  // PxCvx
  console.log('\nPxCvx operator must be PirexCvx');
  console.log(`PxCvx: ${(await pxCvxContract.operator()) === pirexCvx}`);

  // PirexCvx - fees
  console.log('\nPirexCvx fees must be set');
  console.log(`PirexCvx reward fee: ${await pirexCvxContract.fees(0)}`);
  console.log(`PirexCvx redemption max fee: ${await pirexCvxContract.fees(1)}`);
  console.log(`PirexCvx redemption min fee: ${await pirexCvxContract.fees(2)}`);
  console.log(`PirexCvx developers fee: ${await pirexCvxContract.fees(3)}`);

  // PirexCvx - unionPirex
  console.log('\nPirexCvx should have UnionPirexVault set');
  console.log(
    `PirexCvx unionPirex: ${
      (await pirexCvxContract.unionPirex()) === unionPirexVault
    }`
  );

  // PirexCvx - minter role
  console.log('\nPirexCvx should have minter role');
  console.log(`SpxCvx: ${await spxCvxContract.hasRole(MINTER_ROLE, pirexCvx)}`);
  console.log(`UpxCvx: ${await upxCvxContract.hasRole(MINTER_ROLE, pirexCvx)}`);
  console.log(`VpxCvx: ${await vpxCvxContract.hasRole(MINTER_ROLE, pirexCvx)}`);
  console.log(`RpxCvx: ${await rpxCvxContract.hasRole(MINTER_ROLE, pirexCvx)}`);

  // UnionPirexVault
  console.log('\nUnionPirexVault should have the correct contracts set');
  console.log(
    `UnionPirexVault platform: ${
      (await unionPirexVaultContract.platform()) === pirexMultisig
    }`
  );
  console.log(
    `UnionPirexVault strategy: ${
      (await unionPirexVaultContract.strategy()) === unionPirexStrategy
    }`
  );

  // PirexCvx - unpaused
  console.log('\nPirexCvx should be unpaused');
  console.log(`PirexCvx: ${(await pirexCvxContract.paused()) === false}`);

  // Ownable-based
  console.log('\nContract owners must be Pirex multisig');
  console.log(`PxCvx: ${(await pxCvxContract.owner()) === pirexMultisig}`);
  console.log(
    `PirexFees: ${(await pirexFeesContract.owner()) === pirexMultisig}`
  );
  console.log(
    `PirexCvx: ${(await pirexCvxContract.owner()) === pirexMultisig}`
  );
  console.log(
    `UnionPirexVault: ${
      (await unionPirexVaultContract.owner()) === pirexMultisig
    }`
  );
  console.log(
    `UnionPirexStrategy: ${
      (await unionPirexStrategyContract.owner()) === pirexMultisig
    }`
  );

  // AccessControl-based
  console.log('\nDeployer does NOT have admin or minter role');
  console.log(
    `SpxCvx: ${
      (await spxCvxContract.hasRole(MINTER_ROLE, deployer.address)) === false &&
      (await spxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) ===
        false
    }`
  );
  console.log(
    `UpxCvx: ${
      (await spxCvxContract.hasRole(MINTER_ROLE, deployer.address)) === false &&
      (await spxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) ===
        false
    }`
  );
  console.log(
    `VpxCvx: ${
      (await spxCvxContract.hasRole(MINTER_ROLE, deployer.address)) === false &&
      (await spxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) ===
        false
    }`
  );
  console.log(
    `RpxCvx: ${
      (await spxCvxContract.hasRole(MINTER_ROLE, deployer.address)) === false &&
      (await spxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, deployer.address)) ===
        false
    }`
  );

  console.log('\nContract admins are Pirex multisig');
  console.log(
    `SpxCvx: ${
      (await spxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, pirexMultisig)) === true
    }`
  );
  console.log(
    `UpxCvx: ${
      (await upxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, pirexMultisig)) === true
    }`
  );
  console.log(
    `VpxCvx: ${
      (await vpxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, pirexMultisig)) === true
    }`
  );
  console.log(
    `RpxCvx: ${
      (await rpxCvxContract.hasRole(DEFAULT_ADMIN_ROLE, pirexMultisig)) === true
    }`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
