import { expect } from 'chai';
import { ethers } from 'hardhat';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  setUpConvex,
} from './helpers';
import {
  ConvexToken,
  CvxLocker,
  DelegateRegistry,
  PirexCvx,
} from '../typechain-types';

describe('PirexCvx', () => {
  let pCvx: PirexCvx;
  let cvx: ConvexToken;
  let cvxLocker: CvxLocker;
  let cvxDelegateRegistry: DelegateRegistry;

  const zeroAddress = '0x0000000000000000000000000000000000000000';

  before(async () => {
    ({ cvx, cvxLocker, cvxDelegateRegistry } =
      await setUpConvex());

    pCvx = await (
      await ethers.getContractFactory('PirexCvx')
    ).deploy(
      cvx.address,
      cvxLocker.address,
      cvxDelegateRegistry.address
    );
  });

  describe('constructor', () => {
    it('Should set up contract state', async () => {
      const cvx_ = await pCvx.cvx();
      const cvxLocker_ = await pCvx.cvxLocker();
      const cvxDelegateRegistry_ = await pCvx.cvxDelegateRegistry();

      expect(cvx_).to.equal(cvx.address).to.not.equal(zeroAddress);
      expect(cvxLocker_).to.equal(cvxLocker.address).to.not.equal(zeroAddress);
      expect(cvxDelegateRegistry_)
        .to.equal(cvxDelegateRegistry.address)
        .to.not.equal(zeroAddress);
    });
  });
});
