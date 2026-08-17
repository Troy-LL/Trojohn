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
}

export interface Verdict {
  unitsPerMonth: number;
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
  const unitsPerMonth = node.unitsPerHour * node.hoursPerDay * HOURS_PER_MONTH;

  // Revenue ceiling. Charging above buyerAltUsdPerUnit wins no business, so this
  // is generous by construction: real pricing must undercut it.
  const grossCeilingUsd = unitsPerMonth * market.buyerAltUsdPerUnit;

  const kwh = (node.watts / 1000) * node.hoursPerDay * HOURS_PER_MONTH;
  const electricityUsd = kwh * node.usdPerKwh;

  const afterVerification = grossCeilingUsd * (1 - market.verificationOverhead);
  const afterTake = afterVerification * (1 - market.takeRate);
  const netToOwnerUsd = afterTake - electricityUsd;

  return {
    unitsPerMonth,
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
  console.log(`  volume            ${fmt(v.unitsPerMonth)} ${market.unit}/month`);
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
 * Verified real-device presence. One device-hour per hour served.
 * Buyer alternative: AWS Device Farm unmetered slot, $250/month => $0.347/device-hour.
 * Deliberately the conservative anchor; metered is $0.17/device-MINUTE (~$10/hr).
 */
export const DEVICE_PRESENCE = {
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

  const embBelowFloor = emb.netToOwnerUsd < CONSUMER_FLOOR_USD;
  const devAboveFloor = dev.netToOwnerUsd > CONSUMER_FLOOR_USD;
  const gapIsOrderOfMagnitude = dev.netToOwnerUsd > emb.netToOwnerUsd * 10;

  console.assert(embBelowFloor, `embeddings should net under $${CONSUMER_FLOOR_USD}/month`);
  console.assert(devAboveFloor, `device presence should net over $${CONSUMER_FLOOR_USD}/month`);
  console.assert(gapIsOrderOfMagnitude, 'device presence should beat embeddings 10x+');

  if (!embBelowFloor || !devAboveFloor || !gapIsOrderOfMagnitude) {
    throw new Error('supply-economics self-check failed');
  }
  console.log(
    `\nself-check passed: embeddings $${emb.netToOwnerUsd.toFixed(2)} (under the ` +
      `$${CONSUMER_FLOOR_USD} consumer floor), device presence ` +
      `$${dev.netToOwnerUsd.toFixed(0)} — ${(dev.netToOwnerUsd / emb.netToOwnerUsd).toFixed(0)}x gap`,
  );
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/supply-economics.ts');
if (isMain) {
  console.log('Phone supply-network economics — one retired phone, per month');
  console.log('Revenue ceiling = buyer\'s cheapest credible alternative, not retail API price.');
  report('bulk embeddings (sell FLOPs)', EMBEDDINGS.node, EMBEDDINGS.market);
  report('verified device presence', DEVICE_PRESENCE.node, DEVICE_PRESENCE.market);
  demo();
  console.log('\nSwap in your own quotes before trusting any of this. See docs/phone-supply-network.md');
}
