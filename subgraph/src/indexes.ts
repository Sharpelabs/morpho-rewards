import { Address, BigInt, log } from "@graphprotocol/graph-ts";

import {
  epochNumberToEndTimestamp,
  epochNumberToStartTimestamp,
  fetchDistribution,
  fetchDistributionFromDistributionId,
  ipfsJson,
  timestampToEpochId,
} from "./distributions";
import { getOrInitMarket, getOrInitMarketEpoch } from "./initializer";
import { BASIS_POINTS, WAD } from "./constants";

const getEpochMarketEmissionKey = (marketAddress: Address, epochNumber: i32, marketSide: string): string =>
  "epoch-" + epochNumber.toString() + "-" + marketSide + "-" + marketAddress.toHexString();

/**
 * The emission between timestamp from and timestamp to is linear, and the two timestamps has
 * to be in the same epoch
 */
const computeOneEpochDistribuedRewards = (
  timestampFrom: BigInt,
  timestampTo: BigInt,
  totalSupply: BigInt,
  speed: BigInt
): BigInt => {
  if (speed.isZero()) return BigInt.zero();
  const morphoAccrued = timestampTo.minus(timestampFrom).times(speed); // WAD
  if (morphoAccrued.lt(BigInt.zero())) log.critical("negative token emission {}", [morphoAccrued.toString()]);

  return morphoAccrued.times(WAD).div(totalSupply);
};

const computeUpdatedMorphoIndex = (
  marketAddress: Address,
  blockTimestamp: BigInt,
  lastMorphoIndex: BigInt,
  lastUpdateBlockTimestamp: BigInt,
  lastTotalUnderlying: BigInt,
  marketSide: string
): BigInt => {
  const obj = ipfsJson();
  // sync eventual previous epoch
  const prevEpochNumber = timestampToEpochId(obj, lastUpdateBlockTimestamp);
  const currentEpochNumber = timestampToEpochId(obj, blockTimestamp);
  if (!currentEpochNumber) return lastMorphoIndex;

  if (!prevEpochNumber && currentEpochNumber) {
    // start of the first epoch
    const start = epochNumberToStartTimestamp(obj, currentEpochNumber);
    if (!start) {
      log.critical("No start timestamp for epoch {}", [currentEpochNumber.toString()]);
      return BigInt.zero();
    }
    const accrualIndex = computeOneEpochDistribuedRewards(
      start,
      blockTimestamp,
      lastTotalUnderlying,
      fetchDistribution(obj, blockTimestamp, marketSide, marketAddress)
    );
    return lastMorphoIndex.plus(accrualIndex);
  }
  if (prevEpochNumber && currentEpochNumber && prevEpochNumber !== currentEpochNumber) {
    // need to tackle multiple speeds
    log.warning("Prev epoch: {}, current epoch: {}", [prevEpochNumber.toString(), currentEpochNumber.toString()]);
    const end = epochNumberToEndTimestamp(obj, prevEpochNumber);

    if (!end) {
      log.critical("No end timestamp for epoch {}", [prevEpochNumber.toString()]);
      return BigInt.zero();
    }
    lastMorphoIndex = lastMorphoIndex.plus(
      computeOneEpochDistribuedRewards(
        lastUpdateBlockTimestamp,
        end,
        lastTotalUnderlying,
        fetchDistributionFromDistributionId(obj, getEpochMarketEmissionKey(marketAddress, prevEpochNumber, marketSide))
      )
    );
    const snapshot = getOrInitMarketEpoch(marketAddress, prevEpochNumber, marketSide, end);
    snapshot.index = lastMorphoIndex;
    snapshot.timestamp = end;
    snapshot.isFinished = true;
    snapshot.save();
    const startTimestamp = epochNumberToStartTimestamp(obj, currentEpochNumber);

    if (!startTimestamp) {
      log.critical("No start timestamp for epoch {}", [currentEpochNumber.toString()]);
      return BigInt.zero();
    }
    lastUpdateBlockTimestamp = startTimestamp;
    if (startTimestamp.ge(blockTimestamp)) return lastMorphoIndex;
    // stop the distribution if it is the beginning of the current epoch, else start distribution
  }
  const id = getEpochMarketEmissionKey(marketAddress, currentEpochNumber, marketSide);
  const accrualIndex = computeOneEpochDistribuedRewards(
    lastUpdateBlockTimestamp,
    blockTimestamp,
    lastTotalUnderlying,
    fetchDistributionFromDistributionId(obj, id)
  );
  const newIndex = lastMorphoIndex.plus(accrualIndex);

  const snapshot = getOrInitMarketEpoch(marketAddress, currentEpochNumber, marketSide, blockTimestamp);
  snapshot.index = newIndex;
  snapshot.timestamp = blockTimestamp;
  snapshot.save();

  return newIndex;
};

const computeUpdatedMorphoIndexV2 = (
  marketAddress: Address,
  blockTimestamp: BigInt,
  lastMorphoIndex: BigInt,
  lastUpdateBlockTimestamp: BigInt,
  lastPercentSpeed: BigInt,
  lastTotalScaled: BigInt,
  marketSide: string
): BigInt => {
  const obj = ipfsJson();
  // sync eventual previous epoch
  const prevEpochNumber = timestampToEpochId(obj, lastUpdateBlockTimestamp);
  const currentEpochNumber = timestampToEpochId(obj, blockTimestamp);
  if (!currentEpochNumber) return lastMorphoIndex;

  if (!prevEpochNumber && currentEpochNumber) {
    // start of the first epoch
    const start = epochNumberToStartTimestamp(obj, currentEpochNumber);
    if (!start) {
      log.critical("No start timestamp for epoch {}", [currentEpochNumber.toString()]);
      return BigInt.zero();
    }
    const distribution = fetchDistribution(obj, blockTimestamp, marketSide, marketAddress);
    // consider the speed between onPool & inP2P to be constant between 2 markets update.
    // That means that we consider that the difference of interest generated does not make changes between
    // on pool & in P2P repartition, i.e. lastPercentSpeed is constant.
    const speed = distribution.times(lastPercentSpeed).div(BASIS_POINTS);
    const accrualIndex = computeOneEpochDistribuedRewards(start, blockTimestamp, lastTotalScaled, speed);
    return lastMorphoIndex.plus(accrualIndex);
  }

  if (prevEpochNumber && currentEpochNumber && prevEpochNumber !== currentEpochNumber) {
    // need to tackle multiple speeds
    log.warning("Prev epoch: {}, current epoch: {}", [prevEpochNumber.toString(), currentEpochNumber.toString()]);
    const end = epochNumberToEndTimestamp(obj, prevEpochNumber);

    if (!end) {
      log.critical("No end timestamp for epoch {}", [prevEpochNumber.toString()]);
      return BigInt.zero();
    }
    const distribution = fetchDistributionFromDistributionId(
      obj,
      getEpochMarketEmissionKey(marketAddress, prevEpochNumber, marketSide)
    );
    const speed = distribution.times(lastPercentSpeed).div(BASIS_POINTS);

    lastMorphoIndex = lastMorphoIndex.plus(
      computeOneEpochDistribuedRewards(lastUpdateBlockTimestamp, end, lastTotalScaled, speed)
    );
    const startTimestamp = epochNumberToStartTimestamp(obj, currentEpochNumber);

    if (!startTimestamp) {
      log.critical("No start timestamp for epoch {}", [currentEpochNumber.toString()]);
      return BigInt.zero();
    }
    lastUpdateBlockTimestamp = startTimestamp;
    if (startTimestamp.ge(blockTimestamp)) return lastMorphoIndex;
    // stop the distribution if it is the beginning of the current epoch, else start distribution
  }
  const id = getEpochMarketEmissionKey(marketAddress, currentEpochNumber, marketSide);

  const distribution = fetchDistributionFromDistributionId(obj, id);
  const speed = distribution.times(lastPercentSpeed).div(BASIS_POINTS);
  const accrualIndex = computeOneEpochDistribuedRewards(
    lastUpdateBlockTimestamp,
    blockTimestamp,
    lastTotalScaled,
    speed
  );

  return lastMorphoIndex.plus(accrualIndex);
};

export function updateSupplyIndex(marketAddress: Address, blockTimestamp: BigInt): BigInt {
  const market = getOrInitMarket(marketAddress, blockTimestamp);
  if (market.supplyUpdateBlockTimestampV1.equals(blockTimestamp)) return market.supplyIndex; // nothing to update

  return computeUpdatedMorphoIndex(
    marketAddress,
    blockTimestamp,
    market.supplyIndex,
    market.supplyUpdateBlockTimestampV1,
    market.lastTotalSupply,
    "Supply"
  );
}

export function updateBorrowIndex(marketAddress: Address, blockTimestamp: BigInt): BigInt {
  const market = getOrInitMarket(marketAddress, blockTimestamp);

  if (market.borrowUpdateBlockTimestampV1.ge(blockTimestamp)) return market.borrowIndex;

  return computeUpdatedMorphoIndex(
    marketAddress,
    blockTimestamp,
    market.borrowIndex,
    market.borrowUpdateBlockTimestampV1,
    market.lastTotalBorrow,
    "Borrow"
  );
}
export function updateBorrowIndexOnPool(marketAddress: Address, blockTimestamp: BigInt, indexUnits: u8): BigInt {
  const market = getOrInitMarket(marketAddress, blockTimestamp);
  if (market.borrowUpdateBlockTimestamp.ge(blockTimestamp)) return market.poolBorrowIndex;
  const totalOnPoolInUnderlying = market.scaledBorrowOnPool
    .times(market.lastPoolBorrowIndex)
    .div(BigInt.fromString("10").pow(indexUnits));
  const totalInP2PInUnderlying = market.scaledBorrowInP2P
    .times(market.lastP2PBorrowIndex)
    .div(BigInt.fromString("10").pow(indexUnits));
  const total = totalOnPoolInUnderlying.plus(totalInP2PInUnderlying);
  const onPoolPercent = total.isZero() ? BigInt.zero() : totalOnPoolInUnderlying.times(BASIS_POINTS).div(total);
  return computeUpdatedMorphoIndexV2(
    marketAddress,
    blockTimestamp,
    market.poolBorrowIndex,
    market.borrowUpdateBlockTimestamp,
    onPoolPercent,
    market.scaledBorrowOnPool,
    "Borrow"
  );
}

export function updateBorrowIndexInP2P(marketAddress: Address, blockTimestamp: BigInt, indexUnits: u8): BigInt {
  const market = getOrInitMarket(marketAddress, blockTimestamp);
  if (market.borrowUpdateBlockTimestamp.ge(blockTimestamp)) return market.p2pBorrowIndex;
  const totalOnPoolInUnderlying = market.scaledBorrowOnPool
    .times(market.lastPoolBorrowIndex)
    .div(BigInt.fromString("10").pow(indexUnits));
  const totalInP2PInUnderlying = market.scaledBorrowInP2P
    .times(market.lastP2PBorrowIndex)
    .div(BigInt.fromString("10").pow(indexUnits));
  const total = totalOnPoolInUnderlying.plus(totalInP2PInUnderlying);
  const inP2PPercent = total.isZero() ? BigInt.zero() : totalInP2PInUnderlying.times(BASIS_POINTS).div(total);
  return computeUpdatedMorphoIndexV2(
    marketAddress,
    blockTimestamp,
    market.p2pBorrowIndex,
    market.borrowUpdateBlockTimestamp,
    inP2PPercent,
    market.scaledBorrowInP2P,
    "Borrow"
  );
}
export function updateSupplyIndexOnPool(marketAddress: Address, blockTimestamp: BigInt, indexUnits: u8): BigInt {
  const baseUnits = BigInt.fromString("10").pow(indexUnits);

  const market = getOrInitMarket(marketAddress, blockTimestamp);
  if (market.supplyUpdateBlockTimestamp.ge(blockTimestamp)) return market.poolSupplyIndex;

  const totalOnPoolInUnderlying = market.scaledSupplyOnPool.times(market.lastPoolSupplyIndex).div(baseUnits);

  const totalInP2PInUnderlying = market.scaledSupplyInP2P.times(market.lastP2PSupplyIndex).div(baseUnits);

  const total = totalOnPoolInUnderlying.plus(totalInP2PInUnderlying);

  const onPoolPercent = total.isZero() ? BigInt.zero() : totalOnPoolInUnderlying.times(BASIS_POINTS).div(total);
  return computeUpdatedMorphoIndexV2(
    marketAddress,
    blockTimestamp,
    market.poolSupplyIndex,
    market.supplyUpdateBlockTimestamp,
    onPoolPercent,
    market.scaledSupplyOnPool,
    "Supply"
  );
}

export function updateSupplyIndexInP2P(marketAddress: Address, blockTimestamp: BigInt, indexUnits: u8): BigInt {
  const baseUnits = BigInt.fromString("10").pow(indexUnits);
  const market = getOrInitMarket(marketAddress, blockTimestamp);
  if (market.supplyUpdateBlockTimestamp.ge(blockTimestamp)) return market.p2pSupplyIndex;

  const totalOnPoolInUnderlying = market.scaledSupplyOnPool.times(market.lastPoolSupplyIndex).div(baseUnits);

  const totalInP2PInUnderlying = market.scaledSupplyInP2P.times(market.lastP2PSupplyIndex).div(baseUnits);

  const total = totalOnPoolInUnderlying.plus(totalInP2PInUnderlying);

  const inP2PPercent = total.isZero() ? BigInt.zero() : totalInP2PInUnderlying.times(BASIS_POINTS).div(total);
  return computeUpdatedMorphoIndexV2(
    marketAddress,
    blockTimestamp,
    market.p2pSupplyIndex,
    market.supplyUpdateBlockTimestamp,
    inP2PPercent,
    market.scaledSupplyInP2P,
    "Supply"
  );
}

export function accrueMorphoTokens(marketIndex: BigInt, userIndex: BigInt, userBalance: BigInt): BigInt {
  if (marketIndex.minus(userIndex).lt(BigInt.zero())) {
    log.critical("Inconsistent index computation. User index: {}, market index: {}, substraction: {}", [
      userIndex.toString(),
      marketIndex.toString(),
      marketIndex.minus(userIndex).toString(),
    ]);
  }

  return userBalance.times(marketIndex.minus(userIndex)).div(WAD);
}
