import { expect } from 'chai';
import { PxCvx, UnionPirexVault } from '../typechain-types';

// Tests foundational units outside of the actual deposit flow
describe('PirexCvx-Union', function () {
  let pxCvx: PxCvx;
  let unionPirex: UnionPirexVault;

  before(async function () {
    ({ pxCvx, unionPirex } = this);
  });

  describe('constructor', function () {
    it('Should set up contract state', async function () {
      const pirex = await unionPirex.pirex();
      const asset = await unionPirex.asset();
      const name = await unionPirex.name();
      const symbol = await unionPirex.symbol();

      expect(pirex).to.equal(pxCvx.address);
      expect(asset).to.equal(pxCvx.address);
      expect(name).to.equal('Union Pirex Vault');
      expect(symbol).to.equal('pxCVX');
    });
  });
});
