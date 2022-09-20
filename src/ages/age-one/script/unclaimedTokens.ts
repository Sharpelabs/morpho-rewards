/* eslint-disable no-console */
import { getUserRewards } from "../../../utils";
import { formatUnits } from "ethers/lib/utils";

getUserRewards(process.argv[2], process.argv[3] ? +process.argv[3] : undefined)
  .then((r) =>
    console.log({
      currentEpochRewards: formatUnits(r.currentEpochRewards),
      currentEpochProjectedRewards: formatUnits(r.currentEpochProjectedRewards),
      totalRewardsEarned: formatUnits(r.totalRewardsEarned),
      claimedRewards: formatUnits(r.claimedRewards),
      claimable: formatUnits(r.claimable),
      claimableSoon: formatUnits(r.claimableSoon),
      claimData: r.claimData,
    })
  )
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
