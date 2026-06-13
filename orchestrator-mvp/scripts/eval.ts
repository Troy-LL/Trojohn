/**
 * CLM eval harness — compares deliberation settings from JSONL logs.
 * Runs stubbed offline analysis on existing logs, or live runs when CURSOR_API_KEY is set.
 *
 * Usage:
 *   npm run eval                        # analyze existing logs in logs/
 *   npm run eval -- --live              # full 3-scenario comparison
 *   npm run eval -- --live --inprocess-only   # rounds=0 vs rounds=2 baseline
 *   npm run eval -- --live --simulated-only   # simulated transport only
 *   npm run eval -- --live --hard-queries       # adversarial multi-round probe
 *   npm run eval -- --live --multiround-probe   # force R1→R2 via high gate threshold
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logDir = path.join(projectRoot, 'logs');

const STANDARD_QUERIES = [
  'What causes inflation?',
  'Is nuclear energy safe?',
  'Should companies adopt four-day work weeks?',
  'What is the best way to learn programming?',
  'Does caffeine improve productivity?',
];

const HARD_QUERIES = [
  'Is consciousness purely physical?',
  'Will AI replace most jobs by 2035?',
  'Is intermittent fasting healthier than caloric restriction?',
];

/** Polarizing queries + high gate threshold → R0 judge uncertain → R1/R2 follow-up. */
const MULTIROUND_PROBE_QUERIES = [
  'Is the death penalty morally justified?',
  'Should social media be banned for teenagers under 16?',
  'Is free will real or an illusion?',
];

/** Gate threshold for --multiround-probe (above typical R0 judge scores of 0.82–0.93). */
const MULTIROUND_PROBE_THRESHOLD = '0.95';

interface LogResult {
  kind: 'result';
  sessionId: string;
  confidence: number;
  withinTolerance: boolean;
  mergeStrategy: string;
  totalLatencyMs: number;
  judgeVerdict: { confidence: number } | null;
  similarityMode?: 'embeddings' | 'tfidf';
  similarityMethod?: 'embeddings' | 'tfidf';
  deliberationTrigger?: 'judge-gated' | 'vote';
  transport?: 'inprocess' | 'simulated';
  r0Gate?: 'n/a' | 'early-exit' | 'uncertain' | 'judge-failed';
  confidenceThreshold?: number;
  rounds: Array<{
    round: number;
    phase: string;
    confidence: number;
    earlyExit?: boolean;
    similarityMethod?: 'embeddings' | 'tfidf';
  }>;
}

interface Aggregate {
  label: string;
  sessions: number;
  avgConfidence: number;
  withinToleranceRate: number;
  judgeRate: number;
  avgLatencyMs: number;
  avgRounds: number;
}

function parseResults(): LogResult[] {
  if (!existsSync(logDir)) return [];

  const results: LogResult[] = [];
  for (const file of readdirSync(logDir)) {
    if (!file.endsWith('.jsonl')) continue;
    const lines = readFileSync(path.join(logDir, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as LogResult & { kind?: string };
        if (row.kind === 'result') results.push(row);
      } catch {
        // skip malformed lines
      }
    }
  }
  return results;
}

function aggregate(label: string, rows: LogResult[]): Aggregate {
  if (rows.length === 0) {
    return {
      label,
      sessions: 0,
      avgConfidence: 0,
      withinToleranceRate: 0,
      judgeRate: 0,
      avgLatencyMs: 0,
      avgRounds: 0,
    };
  }

  const sum = rows.reduce(
    (acc, r) => {
      acc.confidence += r.confidence;
      acc.tolerance += r.withinTolerance ? 1 : 0;
      acc.judge += r.mergeStrategy === 'llm-judge' ? 1 : 0;
      acc.latency += r.totalLatencyMs;
      acc.rounds += r.rounds?.length ?? 1;
      return acc;
    },
    { confidence: 0, tolerance: 0, judge: 0, latency: 0, rounds: 0 },
  );

  const n = rows.length;
  return {
    label,
    sessions: n,
    avgConfidence: sum.confidence / n,
    withinToleranceRate: sum.tolerance / n,
    judgeRate: sum.judge / n,
    avgLatencyMs: sum.latency / n,
    avgRounds: sum.rounds / n,
  };
}

function printAggregate(a: Aggregate): void {
  console.log(`\n${a.label}`);
  console.log(`  sessions:           ${a.sessions}`);
  console.log(`  avg confidence:     ${(a.avgConfidence * 100).toFixed(1)}%`);
  console.log(`  within tolerance:   ${(a.withinToleranceRate * 100).toFixed(1)}%`);
  console.log(`  judge invocations:  ${(a.judgeRate * 100).toFixed(1)}%`);
  console.log(`  avg latency:        ${Math.round(a.avgLatencyMs)}ms`);
  console.log(`  avg rounds:         ${a.avgRounds.toFixed(2)}`);
}

function bucketBy<T extends string>(
  results: LogResult[],
  keyFn: (r: LogResult) => T | undefined,
): Map<T, LogResult[]> {
  const map = new Map<T, LogResult[]>();
  for (const r of results) {
    const key = keyFn(r);
    if (!key) continue;
    const bucket = map.get(key) ?? [];
    bucket.push(r);
    map.set(key, bucket);
  }
  return map;
}

function printBuckets(title: string, buckets: Map<string, LogResult[]>): void {
  if (buckets.size === 0) return;
  console.log(`\n${title}`);
  for (const [key, rows] of [...buckets.entries()].sort()) {
    printAggregate(aggregate(`  ${key}`, rows));
  }
}

async function runQueryWithRetry(
  orch: { run: (req: { query: string }) => Promise<unknown> },
  query: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      if (attempt > 1) console.log(`    retry ${attempt}…`);
      await orch.run({ query });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        console.error(`    FAILED: ${msg}`);
        return false;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return false;
}

async function runLiveComparison(): Promise<void> {
  const { loadConfig } = await import('../src/config.js');
  const { Orchestrator } = await import('../src/orchestrator.js');

  const hardQueries = process.argv.includes('--hard-queries');
  const multiroundProbe = process.argv.includes('--multiround-probe');

  if (multiroundProbe) {
    const probeOnlyIdx = process.argv.indexOf('--probe-query');
    const probeOnly =
      probeOnlyIdx >= 0 ? process.argv[probeOnlyIdx + 1] : undefined;
    const probeQueries = probeOnly ? [probeOnly] : MULTIROUND_PROBE_QUERIES;

    if (!process.env.SIMILARITY_MODE) process.env.SIMILARITY_MODE = 'tfidf';
    process.env.DELIBERATION_ROUNDS = '2';
    process.env.TRANSPORT = 'inprocess';
    process.env.CONFIDENCE_THRESHOLD = MULTIROUND_PROBE_THRESHOLD;

    const label = `rounds=2, gate=${MULTIROUND_PROBE_THRESHOLD} (multiround-probe)`;
    console.log(`Running live CLM eval (${probeQueries.length} queries, 1 scenario)…\n`);

    const cfg = loadConfig();
    const orch = new Orchestrator(cfg);
    let failures = 0;
    for (const query of probeQueries) {
      console.log(`  [${label}] ${query.slice(0, 50)}…`);
      const ok = await runQueryWithRetry(orch, query);
      if (!ok) failures++;
    }
    if (failures > 0) console.log(`\n${failures} query run(s) failed — partial logs saved.`);
    return;
  }

  const queries = hardQueries ? HARD_QUERIES : STANDARD_QUERIES;

  const scenarios: Array<{ label: string; env: Record<string, string> }> = [
    { label: 'rounds=0, inprocess', env: { DELIBERATION_ROUNDS: '0', TRANSPORT: 'inprocess' } },
    { label: 'rounds=2, inprocess', env: { DELIBERATION_ROUNDS: '2', TRANSPORT: 'inprocess' } },
    {
      label: 'rounds=2, simulated',
      env: {
        DELIBERATION_ROUNDS: '2',
        TRANSPORT: 'simulated',
        SIM_LATENCY_MS: '200',
        SIM_DROP_RATE: '0.05',
      },
    },
  ];

  if (hardQueries) {
    scenarios.splice(0, scenarios.length, {
      label: 'rounds=2, inprocess (hard)',
      env: { DELIBERATION_ROUNDS: '2', TRANSPORT: 'inprocess' },
    });
  } else if (process.argv.includes('--inprocess-only')) {
    scenarios.splice(2, 1);
  } else if (process.argv.includes('--simulated-only')) {
    scenarios.splice(0, 2);
  }

  if (!process.env.SIMILARITY_MODE) process.env.SIMILARITY_MODE = 'tfidf';

  console.log(
    `Running live CLM eval (${queries.length} queries, ${scenarios.length} scenario(s))…\n`,
  );

  let failures = 0;
  for (const scenario of scenarios) {
    for (const [k, v] of Object.entries(scenario.env)) process.env[k] = v;
    const cfg = loadConfig();
    const orch = new Orchestrator(cfg);

    for (const query of queries) {
      console.log(`  [${scenario.label}] ${query.slice(0, 50)}…`);
      const ok = await runQueryWithRetry(orch, query);
      if (!ok) failures++;
    }
  }

  if (failures > 0) {
    console.log(`\n${failures} query run(s) failed — partial logs saved.`);
  }
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live');

  if (live) {
    await runLiveComparison();
  }

  const results = parseResults();
  if (results.length === 0) {
    console.log('No log results found in logs/. Run queries first or use --live.');
    return;
  }

  console.log('CLM Eval — log analysis');
  console.log('='.repeat(40));

  const singleRound = results.filter((r) => (r.rounds?.length ?? 1) <= 1);
  const multiRound = results.filter((r) => (r.rounds?.length ?? 1) > 1);

  printAggregate(aggregate('All sessions', results));
  printAggregate(aggregate('Single-round (rounds ≤ 1)', singleRound));
  printAggregate(aggregate('Multi-round (rounds > 1)', multiRound));

  if (singleRound.length > 0 && multiRound.length > 0) {
    const s = aggregate('single', singleRound);
    const m = aggregate('multi', multiRound);
    const confDelta = ((m.avgConfidence - s.avgConfidence) * 100).toFixed(1);
    const latDelta = Math.round(m.avgLatencyMs - s.avgLatencyMs);
    console.log('\nDelta (multi vs single):');
    console.log(`  confidence: ${confDelta}pp`);
    console.log(`  latency:    +${latDelta}ms`);
    console.log(`  judge rate: ${((m.judgeRate - s.judgeRate) * 100).toFixed(1)}pp`);
  }

  printBuckets('By deliberation trigger:', bucketBy(results, (r) => r.deliberationTrigger));
  printBuckets('By transport:', bucketBy(results, (r) => r.transport));
  printBuckets('By R0 gate:', bucketBy(results, (r) => r.r0Gate));
  printBuckets('By configured similarity mode:', bucketBy(results, (r) => r.similarityMode));
  printBuckets(
    'By actual similarity method (incl. fallback):',
    bucketBy(results, (r) => r.similarityMethod),
  );

  const fallbackRows = results.filter(
    (r) => r.similarityMode === 'embeddings' && r.similarityMethod === 'tfidf',
  );
  if (fallbackRows.length > 0) {
    console.log(`\nEmbedding→TF-IDF fallback sessions: ${fallbackRows.length}`);
    printAggregate(aggregate('  fallback subset', fallbackRows));
  }

  const intentionalMulti = results.filter(
    (r) => r.r0Gate === 'uncertain' && (r.rounds?.length ?? 0) > 1,
  );
  if (intentionalMulti.length > 0) {
    console.log(`\nIntentional multi-round (r0Gate=uncertain, rounds > 1): ${intentionalMulti.length}`);
    printAggregate(aggregate('  uncertain → follow-up', intentionalMulti));
  }

  const probeRuns = results.filter((r) => (r.confidenceThreshold ?? 0.72) >= 0.95);
  if (probeRuns.length > 0) {
    console.log(`\nHigh-threshold probe runs (gate ≥ 0.95): ${probeRuns.length}`);
    printAggregate(aggregate('  probe subset', probeRuns));
    printBuckets('  probe by R0 gate:', bucketBy(probeRuns, (r) => r.r0Gate));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
