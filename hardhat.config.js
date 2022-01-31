require('dotenv').config()
require("@nomiclabs/hardhat-waffle");

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.7.5",
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
