import { BigNumber, BigNumberish } from "ethers";

/**
 * Get the block number from a timestamp
 * @throws if no Etherscan API key is provided
 * @throws If the timestamp is too far in the future
 *
 * @param timestamp in seconds
 * @param closest "before" or "after"
 * @param apiKey Etherscan API key
 */
export const blockFromTimestamp = async (
  timestamp: BigNumberish,
  closest: "before" | "after",
  apiKey = process.env.ETHERSCAN_API_KEY
) => {
  if (!apiKey) throw new Error("No Etherscan API key provided");
  const fromTS = BigNumber.from(timestamp).toString();
  const response = await fetch(
    `https://api.etherscan.io/api?module=block&action=getblocknobytime&timestamp=${fromTS}&closest=${closest}&apikey=${apiKey}`,
    {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    }
  )
    .then((r) => r.json())
    .then((r) => r.result as string);
  if (response.includes("Error")) throw new Error(`No snapshot block yet for timestamp ${timestamp}`);
  return response;
};
