# Trojohn

Research into distributed inference across many small models: several workers, one orchestrator, one merged answer with a reported agreement score.

**Today the workers are cloud models, not phones.** `ACTIVE_WORKERS` defaults to three frontier models via `@cursor/sdk`; the on-device SLM (`llama3.2:3b`) is configured but not active by default. The phone-mesh target is the research direction, not the current implementation.

The runnable MVP lives in [`orchestrator-mvp/`](orchestrator-mvp/). It simulates the mesh locally (Cursor SDK workers, optional Ollama SLM, optional phone agents) with a deliberation pipeline and a React visualizer.

## Run

```bash
cd orchestrator-mvp
cp .env.example .env   # set CURSOR_API_KEY
npm install
npm run web:build
npm run server
```

- UI + API: `http://localhost:3000`
- Health: `GET /api/health`
- Config: `orchestrator-mvp/.env` (see `.env.example`)

Dev UI with hot reload: `npm run server` and `npm run web:dev` (Vite on `5173`, proxies `/api` → `3000`).

Package details, CLI, WebRTC phone agents, and eval: [`orchestrator-mvp/README.md`](orchestrator-mvp/README.md).

## Docs

- [Architecture](docs/architecture.md) — topology and data flow
- [Design](docs/design.md) — mesh UI behavior
- [Eval](docs/eval.md) — gold command and metrics
- [Phone supply network](docs/phone-supply-network.md) — where retired-phone compute is and isn't viable

## Limits

- Local MVP only; workers are cloud models. Not a phone mesh, and `transport/webrtc/` is a WebSocket star hub — no ICE/STUN/TURN.
- **The agreement score is not a confidence bound.** Measured: five answer pairs identical except for a negated conclusion score 0.918–0.989 against a 0.72 gate. The similarity merge cannot detect contradiction. Do not read `withinTolerance` as a correctness signal.
- No labeled eval set, no token/cost capture, no seeds — `npm run eval` reports agreement and latency, never accuracy.
- Needs `CURSOR_API_KEY` for Cursor workers; Ollama optional for local SLM / embeddings
- Windows paths with `&` break npm `.cmd` shims — package scripts invoke CLIs via `node node_modules/...`
