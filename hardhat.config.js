require("dotenv").config();
require("@nomiclabs/hardhat-waffle");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.0",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url:
          process.env.MAINNET_URL !== undefined ? process.env.MAINNET_URL : "",
      },
      accounts: {
        mnemonic: process.env.SEED,
      },
    },
  },
};
