import { loadConfig } from './config.js';
import { checkModelHealth } from './registry.js';
import { Orchestrator } from './orchestrator.js';

function parseArgs(argv: string[]): { server: boolean; query?: string } {
  const server = argv.includes('--server');
  const qIdx = argv.indexOf('--query');
  const query = qIdx >= 0 ? argv[qIdx + 1] : undefined;
  return { server, query };
}

async function runCli(query: string): Promise<void> {
  const cfg = loadConfig();
  const health = await checkModelHealth(cfg);
  console.log('Model health:', health);

  const orch = new Orchestrator(cfg);
  console.log(`\nQuery: ${query}\nWorkers: ${orch.getWorkerIds().join(', ')}\n`);

  const result = await orch.run({ query });
  console.log('--- FINAL ---');
  console.log(result.finalOutput);
  console.log('\n--- META ---');
  console.log(JSON.stringify({
    confidence: result.confidence,
    withinTolerance: result.withinTolerance,
    mergeStrategy: result.mergeStrategy,
    totalLatencyMs: result.totalLatencyMs,
    rounds: result.rounds.length,
    earlyExit: result.rounds[0]?.earlyExit ?? false,
    deliberationTrigger: result.deliberationTrigger,
    similarityMode: result.similarityMode,
    similarityMethod: result.similarityMethod,
    transport: result.transport,
    r0Gate: result.r0Gate,
    confidenceThreshold: result.confidenceThreshold,
  }, null, 2));
}

async function main(): Promise<void> {
  const { server, query } = parseArgs(process.argv.slice(2));
  if (server) {
    const { startServer } = await import('./server.js');
    await startServer(loadConfig());
    return;
  }
  if (query) {
    await runCli(query);
    return;
  }
  console.log(`Usage:
  npx tsx src/index.ts --query "Your question"
  npx tsx src/index.ts --server
  npm run server`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
