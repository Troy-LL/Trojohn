# Orchestrator MVP (CLM v0.3.2)

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

# Deliberation preset (.env): DELIBERATION_ROUNDS=2, CRITICAL_THINKING=true, R0_GATE_THRESHOLD=0.85

# CLI one-shot
npm run query -- "What causes inflation?"

# Deliberation pipeline (Q → propose → critique → revise, judge-gated)
DELIBERATION_ROUNDS=2 npm run query -- "What causes inflation?"

# Parallel scratchpad/claims alongside free-text answers
SCRATCHPAD_MODE=parallel DELIBERATION_ROUNDS=2 npm run query -- "What causes inflation?"

# WebRTC mesh (hub on SIGNAL_PORT, phone agents connect separately)
TRANSPORT=webrtc npm run server
npm run phone-agent -- --node phone-1 --role local

# Eval + session store aggregates
npm run eval
npm run eval -- --live --continue-on-failure
npm run analyze
```

## Thresholds

| Env | Default | Role |
|-----|---------|------|
| `CONFIDENCE_THRESHOLD` | 0.72 | Merge tolerance (vote/judge confidence) |
| `R0_GATE_THRESHOLD` | 0.85 | R0 judge early-exit bar (judge-gated mode only) |

## Architecture

- **Workers** — `CursorWorker` via `@cursor/sdk`; `OllamaWorker` for local SLM; `RemoteWorker` for mesh phone nodes
- **Deliberation** — Q → propose → critique → revise when `DELIBERATION_ROUNDS > 0`
- **Scratchpad** — parallel structured claims when `SCRATCHPAD_MODE=parallel`
- **Merge** — hybrid vote + LLM judge; post-deliberation judge is authoritative
- **Transport** — `inprocess`, `simulated`, or `webrtc` (WebSocket hub-and-spoke)
- **Store** — JSONL logs + JSON session index at `data/orchestrator-index.json`
- **Attestation** — lightweight commitment hashes + audit scores for mesh nodes

## API

- `GET /api/health` — thresholds, deliberation, transport, mesh node count
- `GET /api/workers` — connected mesh nodes + attestation registry
- `GET /api/events?sessionId=<uuid>` — SSE stream
- `POST /api/run/stream` — `{ "query": "...", "sessionId": "<uuid>" }`

## Tests

```bash
npm test
```
