# Eval

Gold command (from `orchestrator-mvp/`):

```bash
npm run eval
```

Analyzes existing JSONL under `orchestrator-mvp/logs/`. Prints confidence, latency, judge-rate, R0 gate, and transport breakdowns to stdout. Does not write a separate score file.

Session-store aggregates:

```bash
npm run analyze
```

Reads the JSON session index at `DB_PATH` (default `data/orchestrator-index.json`) via [`src/store/sessionIndex.ts`](../orchestrator-mvp/src/store/sessionIndex.ts). Despite the `--sqlite` flag name on the script, there is no SQLite involved.

## What this harness does not measure

No accuracy, no cost, no calibration. There is no labeled dataset, no token capture, and no seeds, so every metric below is agreement-and-latency only. Two workers that confidently agree on the same wrong answer score near 1.0. Treat `confidence` and `withinTolerance` as diagnostics of the mechanism, never as evidence of correctness.

## Live probe

Requires `CURSOR_API_KEY` in `.env`:

```bash
npm run eval -- --live
npm run eval -- --live --continue-on-failure
npm run eval -- --live --inprocess-only
npm run eval -- --live --simulated-only
npm run eval -- --live --hard-queries
npm run eval -- --live --multiround-probe
```

`--multiround-probe` forces a high R0 gate (`0.95`) on polarizing queries so R1/R2 fire.

## Sample floor

Offline `npm run eval` needs at least one `logs/*.jsonl` with `kind: "result"` records. Live mode runs the standard five queries (or hard / multiround sets in `scripts/eval.ts`).

## Metrics (stdout prefixes)

Compare across runs: confidence, `withinTolerance`, `totalLatencyMs`, judge confidence, `r0Gate`, `transport`, `similarityMethod`, deliberation round count.

Unit tests (`npm test`) own deterministic booleans; this harness owns scored / live comparison. Prompt text for workers stays in code (`WorkerConfig` / deliberation), not in this file. Dated score archives belong under `evals/` when you start keeping them.
