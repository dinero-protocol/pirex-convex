import * as dotenv from 'dotenv';

import { HardhatUserConfig, task } from 'hardhat/config';

import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-gas-reporter';

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.5.16',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.6',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.6.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.4',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: '0.8.12',
        settings: {
          optimizer: {
            enabled: true,
            runs: 179,
          },
        },
      },
    ],
  },
  networks: {
    mainnet: {
      url: process.env.MAINNET_URL || '',
      gasPrice: 25000000000,
      ...(process.env.MAINNET_PRIVATE_KEY && {
        accounts: [process.env.MAINNET_PRIVATE_KEY],
      }),
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    goerli: {
      url: '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    hardhat: {
      chainId: 31337,
      forking: {
        url:
          process.env.MAINNET_URL !== undefined ? process.env.MAINNET_URL : '',
        blockNumber: 14214296,
      },
      accounts: {
        mnemonic: process.env.SEED,
      },
    },
    rinkeby: {
      url: process.env.RINKEBY_URL || '',
      ...(process.env.RINKEBY_PRIVATE_KEY && {
        accounts: [process.env.RINKEBY_PRIVATE_KEY],
      }),
    },
  },
  mocha: {
    timeout: 60000,
  },
  typechain: {
    target: 'ethers-v5',
    externalArtifacts: ['lib/contracts/*.json'],
  },
};

export default config;
