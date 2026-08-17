/**
 * Phone supply-network break-even calculator.
 *
 * Answers one question: can a phone owner be paid anything for this workload
 * while the network still undercuts what the buyer would otherwise spend?
 *
 * The ceiling on revenue is NOT the retail API price — it is the buyer's
 * marginal cost for the same volume elsewhere (a rented GPU). Pricing against
 * retail is how the first version of this analysis was wrong by ~3x.
 *
 * Run:  npm run economics
 * Docs: ../../docs/phone-supply-network.md
 */

export interface NodeProfile {
  /** Units of work a single retired phone sustains per hour. Sustained, not burst. */
  unitsPerHour: number;
  /** Hours per day the node is actually serving. */
  hoursPerDay: number;
  /** Sustained draw while working. */
  watts: number;
  usdPerKwh: number;
}

export interface MarketProfile {
  /** Human label for one unit, e.g. '1M tokens' or 'device-hour'. */
  unit: string;
  /** What the buyer pays per unit for the cheapest credible alternative. */
  buyerAltUsdPerUnit: number;
  /** Fraction of compute burned on redundancy / canaries. 0.15 = 15%. */
  verificationOverhead: number;
  /** Network's cut of gross. 0.2 = 20%. */
  takeRate: number;
  /**
   * Total units the whole market will buy from this network per month, and the
   * fleet those units are spread across. Utilization = demand / fleet, capped by
   * what one device can physically produce.
   *
   * This is the term whose absence made the first draft wrong: a device-hour
   * price is meaningless if nobody buys that hour. Omit both to assume a device
   * sells everything it can make (the old, over-optimistic behaviour).
   */
  marketDemandUnitsPerMonth?: number;
  fleetSize?: number;
}

export interface Verdict {
  /** What one device could produce if everything it made was bought. */
  capacityPerMonth: number;
  /** What it actually sells, after demand is spread across the fleet. */
  unitsPerMonth: number;
  /** unitsPerMonth / capacityPerMonth. 1 = saturated, 0.01 = mostly idle. */
  utilization: number;
  /** Ceiling: selling every unit at exactly the buyer's alternative cost. */
  grossCeilingUsd: number;
  electricityUsd: number;
  netToOwnerUsd: number;
  /** Multiple of electricity cost the owner nets. <1 means the phone loses money. */
  marginRatio: number;
  viable: boolean;
}

const HOURS_PER_MONTH = 30;

export function evaluate(node: NodeProfile, market: MarketProfile): Verdict {
  const capacityPerMonth = node.unitsPerHour * node.hoursPerDay * HOURS_PER_MONTH;

  // Demand-limited, not capacity-limited. A phone only earns for units actually sold.
  const demandShare =
    market.marketDemandUnitsPerMonth !== undefined && market.fleetSize
      ? market.marketDemandUnitsPerMonth / market.fleetSize
      : Infinity;
  const unitsPerMonth = Math.min(capacityPerMonth, demandShare);

  // Revenue ceiling. Charging above buyerAltUsdPerUnit wins no business, so this
  // is generous by construction: real pricing must undercut it.
  const grossCeilingUsd = unitsPerMonth * market.buyerAltUsdPerUnit;

  const kwh = (node.watts / 1000) * node.hoursPerDay * HOURS_PER_MONTH;
  const electricityUsd = kwh * node.usdPerKwh;

  const afterVerification = grossCeilingUsd * (1 - market.verificationOverhead);
  const afterTake = afterVerification * (1 - market.takeRate);
  const netToOwnerUsd = afterTake - electricityUsd;

  return {
    capacityPerMonth,
    unitsPerMonth,
    utilization: capacityPerMonth > 0 ? unitsPerMonth / capacityPerMonth : 0,
    grossCeilingUsd,
    electricityUsd,
    netToOwnerUsd,
    marginRatio: electricityUsd > 0 ? afterTake / electricityUsd : Infinity,
    viable: netToOwnerUsd > 0,
  };
}

function fmt(n: number): string {
  return n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4);
}

export function report(label: string, node: NodeProfile, market: MarketProfile): Verdict {
  const v = evaluate(node, market);
  console.log(`\n${label}`);
  console.log(`  capacity          ${fmt(v.capacityPerMonth)} ${market.unit}/month`);
  console.log(
    `  actually sold     ${fmt(v.unitsPerMonth)} ${market.unit}/month` +
      (v.utilization < 1 ? `  (${(v.utilization * 100).toFixed(1)}% utilization)` : ''),
  );
  console.log(`  gross ceiling     $${fmt(v.grossCeilingUsd)}/month  (at buyer's alternative cost)`);
  console.log(`  electricity       $${fmt(v.electricityUsd)}/month`);
  console.log(`  net to owner      $${fmt(v.netToOwnerUsd)}/month`);
  console.log(`  margin vs power   ${v.marginRatio === Infinity ? 'n/a' : `${fmt(v.marginRatio)}x`}`);
  console.log(`  verdict           ${v.viable ? 'positive' : 'DEAD — owner loses money'}`);
  return v;
}

/** Old phone, plugged in, 18h/day. Measured energy figures from MELTing Point. */
const RETIRED_PHONE = { hoursPerDay: 18, watts: 6, usdPerKwh: 0.15 };

/**
 * Bulk embeddings. Phone sustained prefill assumed 200 tok/s — already generous
 * for old silicon vs the 791 tok/s flagship burst figure.
 * Buyer alternative: A100 80GB at $1.04/hr, 60k tok/s sustained => $0.0097/1M.
 */
export const EMBEDDINGS = {
  node: { ...RETIRED_PHONE, unitsPerHour: (200 * 3600) / 1_000_000 },
  market: {
    unit: '1M tokens',
    buyerAltUsdPerUnit: 0.0097,
    verificationOverhead: 0.15,
    takeRate: 0.2,
  },
};

/**
 * Verified real-device presence, priced honestly.
 *
 * The first draft used AWS Device Farm's $250/month unmetered tier as the unit
 * price. That was wrong: AWS states "slots determine concurrency", so $250 buys
 * a concurrency license against a shared pool, not a handset. Its own metered
 * breakeven is 1470 device-minutes = 24.5 device-hours/month, a 3.4% duty cycle.
 *
 * Corrected inputs:
 * - retail managed device-hour: $5 (Firebase Test Lab physical device)
 * - supply-side capture: ~2%. Measured: Honeygain pays owners $0.10-0.20/GB
 *   against Bright Data's $8.40/GB retail = 1.2-2.4%.
 * - market demand: BrowserStack's ~30k devices serve essentially all global
 *   real-device demand with idle headroom; at AWS's own 24.5 h/month duty cycle
 *   that is ~735k device-hours/month for the whole market.
 * - fleet: 100k recruited phones, i.e. a successful launch.
 */
export const DEVICE_PRESENCE = {
  node: { ...RETIRED_PHONE, unitsPerHour: 1 },
  market: {
    unit: 'device-hour',
    buyerAltUsdPerUnit: 5 * 0.02,
    verificationOverhead: 0.12,
    takeRate: 0.3,
    marketDemandUnitsPerMonth: 30_000 * 24.5,
    fleetSize: 100_000,
  },
};

/**
 * The retracted version, kept only to show what the missing utilization term was
 * worth. Do not cite this row.
 */
export const DEVICE_PRESENCE_NAIVE = {
  node: { ...RETIRED_PHONE, unitsPerHour: 1 },
  market: {
    unit: 'device-hour',
    buyerAltUsdPerUnit: 250 / (24 * 30),
    verificationOverhead: 0.05,
    takeRate: 0.3,
  },
};

/**
 * Below this, an owner will not install anything — the phone technically nets
 * money but not enough to bother, which is the trap the embeddings case falls into.
 */
export const CONSUMER_FLOOR_USD = 5;

/**
 * Self-check. The claim being defended is NOT "embeddings lose money" — they
 * clear electricity. It is that they clear it by an amount no consumer acts on,
 * while device presence clears it by two orders of magnitude.
 */
export function demo(): void {
  const emb = evaluate(EMBEDDINGS.node, EMBEDDINGS.market);
  const dev = evaluate(DEVICE_PRESENCE.node, DEVICE_PRESENCE.market);
  const naive = evaluate(DEVICE_PRESENCE_NAIVE.node, DEVICE_PRESENCE_NAIVE.market);

  // Both candidate businesses fail the consumer floor. That is the finding.
  const embBelowFloor = emb.netToOwnerUsd < CONSUMER_FLOOR_USD;
  const devBelowFloor = dev.netToOwnerUsd < CONSUMER_FLOOR_USD;
  // Utilization, not price, is what separates the honest model from the retracted one.
  const utilizationIsTheKill = dev.utilization < 0.05 && naive.netToOwnerUsd > CONSUMER_FLOOR_USD;

  console.assert(embBelowFloor, `embeddings net under $${CONSUMER_FLOOR_USD}`);
  console.assert(devBelowFloor, `device presence also nets under $${CONSUMER_FLOOR_USD}`);
  console.assert(utilizationIsTheKill, 'demand/fleet utilization is what kills device presence');

  if (!embBelowFloor || !devBelowFloor || !utilizationIsTheKill) {
    throw new Error('supply-economics self-check failed');
  }
  console.log(
    `\nself-check passed: BOTH models fail the $${CONSUMER_FLOOR_USD} consumer floor.\n` +
      `  embeddings                 $${emb.netToOwnerUsd.toFixed(2)}/month\n` +
      `  device presence (honest)   $${dev.netToOwnerUsd.toFixed(2)}/month at ` +
      `${(dev.utilization * 100).toFixed(1)}% utilization\n` +
      `  device presence (retracted)$${naive.netToOwnerUsd.toFixed(0)}/month — the ` +
      `$${(naive.netToOwnerUsd - dev.netToOwnerUsd).toFixed(0)} difference was the missing ` +
      `utilization term`,
  );
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/supply-economics.ts');
if (isMain) {
  console.log('Phone supply-network economics — one retired phone, per month');
  console.log('Revenue ceiling = buyer\'s cheapest credible alternative, not retail API price.');
  report('bulk embeddings (sell FLOPs)', EMBEDDINGS.node, EMBEDDINGS.market);
  report('verified device presence', DEVICE_PRESENCE.node, DEVICE_PRESENCE.market);
  report('device presence, RETRACTED pricing', DEVICE_PRESENCE_NAIVE.node, DEVICE_PRESENCE_NAIVE.market);
  demo();
  console.log('\nSwap in your own quotes before trusting any of this. See docs/phone-supply-network.md');
}
