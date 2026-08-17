# Architecture

Trojohn’s MVP is a single orchestrator process that fans one query out to isolated workers, moves deliberation messages over a transport seam, then merges outputs under a confidence gate. Schema: [`orchestrator-mvp/src/types.ts`](../orchestrator-mvp/src/types.ts). Transport contract: [`orchestrator-mvp/src/transport/types.ts`](../orchestrator-mvp/src/transport/types.ts).

## Context

```
Operator / UI ──HTTP+SSE──▶ Orchestrator (Node)
                                │
                                ├─ Worker pool (Cursor SDK / Ollama / Remote)
                                ├─ Transport bus (inprocess | simulated | webrtc)
                                ├─ Merge + judge
                                └─ Session index (JSON) + JSONL logs
```

Phone-era target: each worker is an on-device SLM node. The MVP keeps the same routing, isolation, merge, and confidence logic; only transport and compute change.

## Containers (now)

| Piece | Process / module | Role |
| --- | --- | --- |
| Orchestrator | `orchestrator-mvp` Express + `Orchestrator` | Route, dispatch, deliberate, merge |
| Workers | `CursorWorker`, `OllamaWorker`, `RemoteWorker` | Isolated answers; no shared worker state |
| Transport | `createTransport` in `src/transport/factory.ts` | Message bus for lifecycle + deliberation |
| Signaling | WebSocket hub on `SIGNAL_PORT` (default 3001) | Star hub. WebRTC-shaped wire format, but no ICE / SDP / DTLS / STUN / TURN — carrier NAT is untouched. |
| Phone agent | `npm run phone-agent` | Remote mesh node joining the hub |
| UI | static `web/dist` or Vite | Mesh visualizer; SSE subscriber |
| Store | `data/orchestrator-index.json` + `logs/*.jsonl` | Session aggregates and audit trail |

Replica count: **1** orchestrator. Worker count = `ACTIVE_WORKERS` (and connected mesh nodes when `TRANSPORT=webrtc`).

## Data flow

1. Client opens SSE `GET /api/events?sessionId=…`, then `POST /api/run/stream` with the same id.
2. Orchestrator selects workers, publishes `query_started` / `worker_*` on the transport.
3. If `DELIBERATION_ROUNDS > 0`: optional question round → propose (R0) → R0 judge gate → critique/revise only when below `R0_GATE_THRESHOLD`.
4. Voters merge by similarity (`SIMILARITY_MODE=embeddings` with TF-IDF fallback); advocate feeds the judge; `CONFIDENCE_THRESHOLD` sets merge tolerance.
5. Result is streamed as `final`, written to logs and the session index.

Deliberation traffic is proposal / critique / revision (and claim ops when `SCRATCHPAD_MODE=parallel`) on the bus — not direct worker-to-worker calls.

## Models and tools

- Cursor workers use `@cursor/sdk` with one `CURSOR_API_KEY` (no per-provider SDKs in-process).
- Local SLM and embeddings talk to Ollama at `OLLAMA_URL`.
- Judge is a configured model role (`JUDGE_MODEL` / default worker), not a separate service.
- Attestation registry stores commitment hashes and audit scores for mesh nodes (`/api/workers`).

## Not in this topology yet

Layer/tensor sharding across phones, TURN for production NAT, and compute rental markets. Agent-layer text deliberation is the merge path today.
