# Orchestrator MVP — Multi-Model Sandboxed Agent System
**Version:** 0.3 (CLM deliberation pipeline)  
**Status:** Implemented in [`orchestrator-mvp/`](orchestrator-mvp/)  
**Context:** Local development inside Cursor IDE

### v0.3.2 implementation notes
- **Split gate thresholds:** `R0_GATE_THRESHOLD` (default 0.85) for R0 early-exit; `CONFIDENCE_THRESHOLD` for merge tolerance.
- **UI telemetry:** R0 gate badge, judge confidence, both thresholds, critical questions, scratchpad panel.
- **Session store:** JSON index at `data/orchestrator-index.json` for cross-session aggregates (`npm run analyze`).
- **Scratchpad mode:** `SCRATCHPAD_MODE=parallel` adds structured claims alongside free-text deliberation.
- **WebRTC mesh (v1):** `TRANSPORT=webrtc` hub-and-spoke over WebSocket signaling; `npm run phone-agent` for remote nodes.
- **Attestation registry:** commitment hashes + audit scores on `/api/workers`.

### v0.3.1 implementation notes
- **Semantic similarity:** Ollama embeddings (`SIMILARITY_MODE=embeddings`, default) replace TF-IDF for voter agreement; auto-falls back to TF-IDF if Ollama is down.
- **Judge-gated deliberation:** When `DELIBERATION_ROUNDS > 0`, R0 runs first → quick judge screen → follow-up rounds only if judge confidence is below threshold.
- **Advocate R0-only:** Devil's advocate runs in the proposal round only (feeds judge, no recursion).

### v0.3 implementation notes (CLM Phase 2)
- **Deliberation pipeline:** Multi-round agent-layer pipeline — propose (R0) → critique (R1) → revise (R2), gated by `DELIBERATION_ROUNDS` (default `0` preserves v0.2 single-shot behavior).
- **Early exit:** Skips follow-up rounds when voter similarity clears `CONFIDENCE_THRESHOLD`.
- **Transport routing:** Deliberation outputs flow as `proposal` / `critique` / `revision` messages through the transport bus (not direct worker-to-worker calls).
- **SimulatedNetworkTransport:** `TRANSPORT=simulated` adds latency, jitter, and drops on deliberation messages only — phone-mesh dress rehearsal.
- **Local SLM worker:** `OllamaWorker` via `ACTIVE_WORKERS=...,local` — same `WorkerResult` contract as Cursor SDK workers.
- **Eval harness:** `npm run eval` compares confidence/latency/judge-rate from JSONL logs; `npm run eval -- --live` runs live scenarios.

### v0.2 implementation notes (vs v0.1 design)
- **Workers:** All models run through `@cursor/sdk` with a single `CURSOR_API_KEY` (no direct Anthropic/OpenAI/Google SDKs).
- **Roles:** Hybrid merge — factual + reasoning workers vote; devil's advocate excluded from vote, feeds the LLM judge on low confidence.
- **Similarity:** TF-IDF cosine (no embedding API on Cursor-only keys).
- **UI:** HTTP server + React mesh visualizer with live SSE token streaming.
- **Transport seam:** `InProcessTransport` + `Message` schema with `round` field for phase-2 deliberation / simulated WebRTC.
- **Logs:** JSONL per session in `orchestrator-mvp/logs/`.

---

## 1. What we're building

A local orchestrator that routes a single user query to multiple isolated model sandboxes (each running a different LLM via API), collects their outputs, and merges them into a single response that falls within an acceptable confidence/accuracy bound.

This is the software simulation of the eventual phone-mesh architecture. Each sandbox here represents what will later become a phone node running an SLM.

---

## 2. Goals for MVP

- Spin up N sandboxed "workers," each calling a different model (Claude, GPT-4o, Gemini, etc.)
- Workers run in isolation — no shared state, no awareness of each other
- Orchestrator manages routing, timeout, and collection
- A merge layer compares outputs and produces a final answer
- Configurable error tolerance (`CONFIDENCE_THRESHOLD`) — if outputs diverge too much, flag it instead of silently returning garbage
- Everything runs locally inside Cursor with a `.env` for keys

---

## 3. What we are NOT doing yet

- No phone hardware, no WebRTC, no P2P mesh
- No persistent memory or cross-session context
- No authentication or user accounts
- No production deployment

---

## 4. System components

```
┌─────────────────────────────────────────────────┐
│                   Orchestrator                   │
│                                                 │
│  ┌──────────────┐      ┌─────────────────────┐  │
│  │ Task Router  │─────▶│   Worker Registry   │  │
│  └──────────────┘      └─────────────────────┘  │
│         │                        │               │
│         ▼                        ▼               │
│  ┌──────────────────────────────────────────┐   │
│  │              Sandbox Pool                │   │
│  │                                          │   │
│  │  [Worker A]  [Worker B]  [Worker C]  …  │   │
│  │  Claude      GPT-4o      Gemini          │   │
│  └──────────────────────────────────────────┘   │
│         │                                        │
│         ▼                                        │
│  ┌──────────────────────────────────────────┐   │
│  │           Merge + Validator              │   │
│  └──────────────────────────────────────────┘   │
│         │                                        │
│         ▼                                        │
│     Final Output                                 │
└─────────────────────────────────────────────────┘
```

---

## 5. File structure

```
orchestrator-mvp/
├── .env                        # API keys — never committed
├── .env.example                # Template showing required keys
├── package.json
├── src/
│   ├── index.ts                # Entry point, CLI or HTTP server
│   ├── orchestrator.ts         # Core loop: route → dispatch → merge
│   ├── router.ts               # Decides which workers to use per query
│   ├── registry.ts             # Worker definitions, health status
│   ├── merge.ts                # Output comparison and consensus logic
│   ├── workers/
│   │   ├── base.ts             # Abstract Worker class
│   │   ├── claude.ts           # Anthropic worker
│   │   ├── openai.ts           # OpenAI worker
│   │   └── gemini.ts           # Google Gemini worker
│   └── types.ts                # Shared types
├── tests/
│   └── merge.test.ts           # Unit tests for the merge layer
└── SPEC.md                     # This file
```

---

## 6. Core types

```typescript
// types.ts

export type ModelProvider = 'anthropic' | 'openai' | 'gemini';

export interface WorkerConfig {
  id: string;                  // e.g. "claude-sonnet", "gpt4o"
  provider: ModelProvider;
  model: string;               // e.g. "claude-sonnet-4-6"
  systemPrompt: string;
  timeoutMs: number;           // hard kill if exceeded
  weight: number;              // influence on final merge (0–1)
}

export interface WorkerResult {
  workerId: string;
  output: string;
  tokensUsed: number;
  latencyMs: number;
  status: 'success' | 'timeout' | 'error';
  errorMessage?: string;
}

export interface OrchestratorRequest {
  query: string;
  context?: string;            // optional injected context / RAG output
  workerIds?: string[];        // optional: force specific workers
}

export interface OrchestratorResponse {
  finalOutput: string;
  confidence: number;          // 0–1, how much workers agreed
  workerResults: WorkerResult[];
  mergeStrategy: string;       // which merge path was taken
  withinTolerance: boolean;    // did we beat CONFIDENCE_THRESHOLD?
}
```

---

## 7. Worker sandbox design

Each worker is an isolated async function with no shared closure state. Workers:

- Receive only `(query, context, config)` — no reference to other workers
- Run concurrently via `Promise.allSettled`
- Are killed after `timeoutMs` using `AbortController`
- Report their own token usage and latency

```typescript
// workers/base.ts

export abstract class BaseWorker {
  constructor(protected config: WorkerConfig) {}

  abstract call(query: string, context?: string): Promise<WorkerResult>;

  protected async withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    ms: number
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fn(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}
```

---

## 8. Orchestrator flow

```typescript
// orchestrator.ts  (pseudocode)

async function run(request: OrchestratorRequest): Promise<OrchestratorResponse> {
  // 1. Route — pick which workers handle this query
  const workers = router.select(request);

  // 2. Dispatch — run all workers in parallel, isolated
  const settled = await Promise.allSettled(
    workers.map(w => w.call(request.query, request.context))
  );

  // 3. Collect results — separate successes from failures
  const results = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { workerId: workers[i].config.id, status: 'error', ... }
  );

  // 4. Merge — compare outputs, build final answer
  return merge(results, request);
}
```

---

## 9. Merge and validation layer

This is the "plus or minus" accuracy gate described in the system design.

### Strategy A — majority vote (MVP default)
Embed each output into a simple vector (TF-IDF or sentence embedding), compute pairwise cosine similarity. If a majority cluster exists above `SIMILARITY_THRESHOLD`, return the output from the highest-weight worker in that cluster.

### Strategy B — LLM-as-judge
Send all worker outputs to a designated "judge" model (e.g. Claude) with the prompt: *"Given these N responses to the query, synthesize the most accurate single answer and flag any factual conflicts."* Costs an extra API call but produces a genuinely merged output rather than a selection.

### Strategy C — fallback / low-confidence flag
If pairwise similarity is below `CONFIDENCE_THRESHOLD` across all pairs, return `withinTolerance: false` and expose all worker outputs to the caller for human review. Do not silently pick one.

```typescript
// merge.ts

const CONFIDENCE_THRESHOLD = 0.72;  // tunable

export function merge(results: WorkerResult[]): OrchestratorResponse {
  const successful = results.filter(r => r.status === 'success');

  if (successful.length === 0) {
    throw new Error('All workers failed or timed out');
  }

  if (successful.length === 1) {
    return singleResult(successful[0]);     // no merge needed
  }

  const similarity = computePairwiseSimilarity(successful);
  const confidence = averageSimilarity(similarity);

  if (confidence >= CONFIDENCE_THRESHOLD) {
    return {
      finalOutput: pickBestByWeight(successful, similarity),
      confidence,
      mergeStrategy: 'majority-vote',
      withinTolerance: true,
      workerResults: results,
    };
  }

  // diverged — flag for review
  return {
    finalOutput: successful[0].output,     // return best worker's output
    confidence,
    mergeStrategy: 'fallback-flagged',
    withinTolerance: false,
    workerResults: results,
  };
}
```

---

## 10. Configuration (.env)

```bash
# .env.example — copy to .env and fill in your keys

# Required: at least one of these
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_KEY=...

# Orchestrator tuning
CONFIDENCE_THRESHOLD=0.72       # minimum similarity to trust the merge
DEFAULT_TIMEOUT_MS=15000        # per-worker hard timeout
ACTIVE_WORKERS=claude,gpt4o     # comma-separated list of enabled workers

# Optional: enable LLM-as-judge merge strategy
JUDGE_WORKER=claude             # which worker acts as the merge judge
USE_LLM_JUDGE=false
```

---

## 11. Cursor-only sandbox testing (no code required)

Before writing a single line of code, you can run a full simulation of the orchestrator using only Cursor's Composer tabs. This validates your system prompts, worker isolation, and merge logic cheaply.

### How it works

Open one Composer tab per worker + one tab for the merge judge. Each tab is a fully isolated context — no worker sees another's output until the merge step.

```
[Composer Tab 1]          [Composer Tab 2]          [Composer Tab 3]
Model: Claude             Model: GPT-4o              Model: Gemini
Role: Worker A            Role: Worker B             Role: Worker C
System: Factual retrieval System: Reasoning chain    System: Devil's advocate
         ↓                         ↓                          ↓
    Output A              Output B                   Output C
         ↓                         ↓                          ↓
              [Composer Tab 4 — Merge Judge]
              Model: Claude (or any)
              Paste all three outputs → final answer
```

### Step 1 — Worker A system prompt (paste at top of Composer Tab 1)

```
You are Worker A in a distributed inference system. Your role is FACTUAL RETRIEVAL.

Rules:
- Answer only with verifiable facts. No speculation.
- If you are uncertain, say so explicitly with your confidence level (e.g. "70% confident").
- Do not ask clarifying questions. Give your best answer immediately.
- Keep your response under 200 words.
- End every response with: [WORKER_A_DONE]
```

### Step 2 — Worker B system prompt (paste at top of Composer Tab 2)

```
You are Worker B in a distributed inference system. Your role is REASONING AND INFERENCE.

Rules:
- Do not just state facts — explain the reasoning chain behind your answer.
- Show your logic step by step.
- If the facts are ambiguous, reason through the most likely interpretation.
- Keep your response under 200 words.
- End every response with: [WORKER_B_DONE]
```

### Step 3 — Worker C system prompt (paste at top of Composer Tab 3)

```
You are Worker C in a distributed inference system. Your role is DEVIL'S ADVOCATE.

Rules:
- Your job is to find what Worker A and Worker B might get wrong.
- Identify edge cases, exceptions, and counterexamples.
- If you agree with the likely answer, still note the strongest counterargument.
- Keep your response under 200 words.
- End every response with: [WORKER_C_DONE]
```

### Step 4 — Merge judge prompt (Composer Tab 4, after collecting A/B/C outputs)

```
You are the Merge Judge in a distributed inference system.

You will receive outputs from three isolated workers (A, B, C) who each answered the same query independently. Your job is to synthesize a final answer.

Process:
1. Identify points all three workers agree on → high confidence, include in final answer
2. Identify points two workers agree on → medium confidence, include with a note
3. Identify points only one worker raised → low confidence, include only if compelling
4. Flag any direct contradictions between workers explicitly

Output format:
FINAL ANSWER: [your synthesized response]
CONFIDENCE: [0–100]%
WITHIN_TOLERANCE: [YES if confidence ≥ 72, NO if below]
CONFLICTS_DETECTED: [list any direct contradictions, or "none"]

---
[paste Worker A output here]
[paste Worker B output here]
[paste Worker C output here]
```

### Running a test session

1. Send the same query to all three worker tabs simultaneously
2. Wait for all three `[WORKER_X_DONE]` markers
3. Copy all three outputs into Tab 4 merge prompt
4. Record: final answer, confidence score, `WITHIN_TOLERANCE` result
5. If `NO` — review the conflicts the judge flagged. That is your divergence log.

### What this validates

| What you're testing | How |
|---|---|
| Worker isolation | Each tab has zero context of the others |
| System prompt quality | Does each role produce meaningfully different outputs? |
| Merge prompt accuracy | Does the judge correctly identify agreement vs conflict? |
| Confidence threshold | Is 72% the right cutoff for your use case? |
| Query types that cause divergence | Track which queries get `WITHIN_TOLERANCE: NO` |

---

## 12. Running inside Cursor (with code)

Once Step 11 validates your prompts, use Cursor's Composer to generate the implementation:

### Setup
```bash
npm init -y
npm install anthropic openai @google/generative-ai dotenv typescript tsx
npx tsc --init
```

### Running
```bash
# Single query test
npx tsx src/index.ts --query "What causes inflation?"

# Run as a local HTTP server (for UI or further tooling)
npx tsx src/index.ts --server --port 3000
```

### Cursor-specific notes
- Store `.env` in project root — Cursor's integrated terminal inherits env vars automatically
- Use Cursor's Composer to ask it to implement individual worker files once this spec is approved
- The `tests/` directory is intentionally included — ask Cursor to generate test cases for the merge layer, as that is the highest-risk logic
- Paste the system prompts from Section 11 directly into your `WorkerConfig.systemPrompt` fields

---

## 13. MVP success criteria

| Criterion | Target |
|-----------|--------|
| Route query to 2+ workers concurrently | ✓ |
| Workers are fully isolated (no shared state) | ✓ |
| Hard timeout per worker (no hanging) | ✓ |
| Merge returns `withinTolerance` flag | ✓ |
| Configurable via `.env` only | ✓ |
| Works with at least 2 providers | ✓ |
| Single command to run | ✓ |

---

## 14. Known limitations and next steps

**Limitations of this MVP:**
- Similarity is computed on raw text — semantic embedding (via a small local model or API) would be more accurate
- No persistent logging of worker outputs for debugging divergence patterns
- LLM-as-judge adds latency and cost — fine for testing, not for production throughput
- Workers share the same system prompt format — no per-worker specialization yet

**Next steps after MVP validation:**
1. ~~Add per-worker specialization~~ ✓ (v0.2)
2. ~~Abstract the worker interface (OllamaWorker)~~ ✓ (v0.3)
3. ~~Multi-round deliberation pipeline~~ ✓ (v0.3)
4. ~~Simulated network transport~~ ✓ (v0.3)
5. ~~Semantic embeddings~~ ✓ (v0.3.1, Ollama fallback)
6. ~~Split R0 gate threshold~~ ✓ (v0.3.2)
7. ~~Session store for divergence analysis~~ ✓ (v0.3.2 JSON index)
8. ~~Scratchpad / collaborative claims (parallel mode)~~ ✓ (v0.3.2 start)
9. ~~WebRTC mesh transport (hub-and-spoke v1)~~ ✓ (v0.3.2 start)
10. Full WebRTC data channels + TURN for production NAT traversal
11. Replace API workers with local SLM workers as default nodes
12. Layer-level model sharding (Petals-style pipeline)

---

## 15. Relationship to target architecture

```
MVP (now)                    →    Target (later)
─────────────────────────────────────────────────
API call to Claude           →    SLM shard on Phone A
API call to GPT-4o           →    SLM shard on Phone B
Promise.allSettled           →    P2P async dispatch over WebRTC
Cosine similarity merge      →    Activation merge + consensus layer
.env config                  →    Worker registry with proof-of-work
Local process                →    Distributed mesh with orchestrator node
```

The orchestrator logic — routing, isolation, merge, confidence threshold — is identical in both versions. The transport and compute layer is what changes.