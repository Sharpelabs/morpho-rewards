import { constants, ethers } from "ethers";
import { MerkleTree } from "merkletreejs";
export type Tree = ReturnType<typeof computeMerkleTree>;
export const computeMerkleTree = (distribution: { address: string; accumulatedRewards: string }[]) => {
  const leaves = distribution.map(
    ({ address, accumulatedRewards }) =>
      ethers.utils.solidityKeccak256(["address", "uint256"], [address, accumulatedRewards]) // 18 * 2 decimals
  );
  const merkleTree = new MerkleTree(leaves, ethers.utils.keccak256, {
    sortPairs: true,
  });

  const proofs: { [user: string]: { amount: string; proof: string[] } } = {};
  let total = constants.Zero;
  distribution.forEach(({ address, accumulatedRewards }) => {
    total = total.add(accumulatedRewards);
    proofs[address] = {
      amount: accumulatedRewards,
      proof: merkleTree.getHexProof(
        ethers.utils.solidityKeccak256(["address", "uint256"], [address, accumulatedRewards])
      ),
    };
  });
  const root = merkleTree.getHexRoot();

  return {
    root,
    total: total.toString(),
    proofs,
    leaves,
  };
};
