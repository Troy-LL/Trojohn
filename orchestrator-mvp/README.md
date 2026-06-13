# Orchestrator MVP (CLM v0.3)

Local multi-model orchestrator: one query fans out to isolated Cursor SDK workers (different models/roles), outputs are merged with a confidence gate, and a web UI visualizes the mesh.

## Setup

```bash
cd orchestrator-mvp
cp .env.example .env   # add CURSOR_API_KEY
npm install
npm run models         # list model IDs for your account
```

## Run

```bash
# HTTP server + built UI (port 3000)
npm run web:build
npm run server

# Dev UI with hot reload (port 5173, proxies /api → 3000)
npm run server         # terminal 1
npm run web:dev        # terminal 2

# CLI one-shot
npm run query -- "What causes inflation?"

# Deliberation pipeline (propose → critique → revise)
DELIBERATION_ROUNDS=2 npm run query -- "What causes inflation?"
# Judge screens R0 first — follow-up rounds only run if judge confidence < threshold

# Semantic voter similarity (requires Ollama with nomic-embed-text)
SIMILARITY_MODE=embeddings npm run query -- "What causes inflation?"

# Simulated phone mesh (latency + drops on deliberation messages)
TRANSPORT=simulated DELIBERATION_ROUNDS=2 npm run server

# Local Ollama worker (add "local" to ACTIVE_WORKERS)
ACTIVE_WORKERS=factual,reasoning,local npm run query -- "What causes inflation?"

# Eval harness (compare logs)
npm run eval
npm run eval -- --live
npm run eval -- --live --multiround-probe   # force R1→R2 (gate=0.95)
npm run eval -- --live --multiround-probe --probe-query "your query"  # single probe rerun
```

## Architecture

- **Workers** — `CursorWorker` via `@cursor/sdk`, one empty sandbox dir per worker; `OllamaWorker` for local SLM
- **Deliberation** — multi-round pipeline (propose/critique/revise) over transport when `DELIBERATION_ROUNDS > 0`
- **Merge** — hybrid: factual + reasoning vote (TF-IDF cosine); advocate feeds judge on low confidence
- **Transport** — `InProcessTransport` (default) or `SimulatedNetworkTransport` (latency/jitter/drop)
- **Logs** — `logs/<sessionId>.jsonl` for divergence calibration and `npm run eval`

## API

- `GET /api/health`
- `GET /api/events?sessionId=<uuid>` — SSE stream
- `POST /api/run/stream` — `{ "query": "...", "sessionId": "<uuid>" }`

## Tests

```bash
npm test
```
