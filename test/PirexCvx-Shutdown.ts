// import { expect } from 'chai';
// import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
// import { ConvexToken, CvxLockerV2, PirexCvx } from '../typechain-types';

// // Tests the emergency relock mechanism on CvxLockerV2 shutdown
// describe('PirexCvx-Shutdown', function () {
//   let notAdmin: SignerWithAddress;
//   let pCvx: PirexCvx;
//   let cvx: ConvexToken;
//   let cvxLocker: CvxLockerV2;
//   let cvxLockerNew: CvxLockerV2;
//   let convexContractEnum: any;

//   before(async function () {
//     ({ notAdmin, pCvx, cvx, cvxLocker, cvxLockerNew, convexContractEnum } =
//       this);
//   });

//   describe('unlock+relock', function () {
//     before(async function () {
//       await pCvx.setPauseState(true);
//     });

//     it('Should revert if not called by owner', async function () {
//       await expect(pCvx.connect(notAdmin).relock()).to.be.revertedWith(
//         'Ownable: caller is not the owner'
//       );

//       await expect(pCvx.connect(notAdmin).unlock()).to.be.revertedWith(
//         'Ownable: caller is not the owner'
//       );
//     });

//     it('Should revert if not paused', async function () {
//       await pCvx.setPauseState(false);

//       await expect(pCvx.relock()).to.be.revertedWith('Pausable: not paused');
//       await expect(pCvx.unlock()).to.be.revertedWith('Pausable: not paused');
//     });

//     it('Should relock any lockable CVX after the shutdown in CvxLockerV2', async function () {
//       await pCvx.setPauseState(true);

//       // Simulate shutdown in the old/current locker
//       await cvxLocker.shutdown();

//       // Withdraw all forced-unlocked CVX
//       await pCvx.unlock();

//       const cvxBalance = await cvx.balanceOf(pCvx.address);
//       const outstandingRedemptions = await pCvx.outstandingRedemptions();

//       // Set the new locker contract and set approval
//       await pCvx.setConvexContract(
//         convexContractEnum.cvxLocker,
//         cvxLockerNew.address
//       );

//       // Attempt to relock with the new locker
//       await pCvx.relock();

//       // Confirm that the correct amount of Cvx are relocked
//       const lockedBalanceAfter = await cvxLockerNew.lockedBalanceOf(
//         pCvx.address
//       );
//       expect(lockedBalanceAfter).to.equal(
//         cvxBalance.sub(outstandingRedemptions)
//       );
//     });
//   });
// });
