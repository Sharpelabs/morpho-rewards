import { providers } from "ethers";
import { EpochConfig } from "../ages.types";
import { AgeDistribution } from "./distributions.types";
import { parseUnits } from "ethers/lib/utils";
import fetchMarketsData from "../../utils/markets/fetchMarketsData";
import fetchProposal from "../../utils/snapshot/fetchProposal";
import { MarketEmission } from "../../utils";
import MARKETS from "./markets";

export const ageThreeDistribution = async (
  ageConfig: AgeDistribution,
  { finalTimestamp, initialTimestamp, number, snapshotBlock, snapshotProposal, totalEmission }: EpochConfig,
  provider?: providers.Provider
) => {
  if (!snapshotBlock) throw Error(`Cannot distribute tokens for epoch ${number}: no snapshotBlock`);
  if (!snapshotProposal) throw Error(`Cannot distribute tokens for epoch ${number}: no snapshotProposal`);
  const proposal = await fetchProposal(snapshotProposal);

  if (proposal.state !== "closed")
    throw Error(`Cannot distribute tokens for epoch ${number}: proposal ${snapshotProposal} is not closed`);
  const duration = finalTimestamp.sub(initialTimestamp);

  const { markets } = await fetchMarketsData(snapshotBlock, provider!);

  const totalScoreBn = parseUnits(proposal.scores_total.toString());

  const marketsEmissions = Object.fromEntries(
    proposal.scores.map((score, index) => {
      const symbol = proposal.choices[index];
      const address = MARKETS[symbol as keyof typeof MARKETS];

      if (!address) throw Error(`Cannot distribute tokens for epoch ${number}: unknown market ${symbol}`);
      const marketData = markets.find((market) => market.address.toLowerCase() === address.toLowerCase());
      if (!marketData) throw Error(`Cannot distribute tokens for epoch ${number}: no market data for ${symbol}`);

      const { morphoSupplyMarketSize, morphoBorrowMarketSize, p2pIndexCursor } = marketData;

      const scoreBn = parseUnits(score.toString());
      const distribution = totalEmission.mul(scoreBn).div(totalScoreBn);
      const total = morphoSupplyMarketSize.add(marketData.morphoBorrowMarketSize);
      const supply = morphoSupplyMarketSize.mul(distribution).div(total);
      const supplyRate = supply.div(duration);
      const borrow = morphoBorrowMarketSize.mul(distribution).div(total);
      const borrowRate = borrow.div(duration);
      const marketEmission = supply.add(borrow);
      return [
        address.toLowerCase(),
        {
          supply,
          supplyRate,
          borrow,
          borrowRate,
          marketEmission,
          morphoBorrow: morphoBorrowMarketSize,
          morphoSupply: morphoSupplyMarketSize,
          p2pIndexCursor,
        } as MarketEmission,
      ];
    })
  );
  return { marketsEmissions };
};
