# Design

Operator UI for the orchestrator mesh lives in `orchestrator-mvp/web/`. One screen: controls, live worker graph, merge verdict, logs.

## Entry and empty states

- Header: **Orchestrator MVP** plus mode badges (single-shot / rounds + Q, simulated mesh, webrtc mesh node count, scratchpad, edge SLM demo).
- Empty merge copy: `Run a simulation to merge worker outputs.`
- While running: `Waiting for workers to complete…`
- Query placeholder: `Type any question or prompt…`
- Run disabled when query is blank or a run is in progress.

## Run loop

1. **Reset** clears session UI state (log line: `Reset — cleared session state`).
2. **Run simulation** mints a `sessionId`, opens `EventSource(/api/events?sessionId=…)`, then `POST /api/run/stream` with `{ query, sessionId, workerIds }`.
3. Live tokens and worker lifecycle arrive over SSE; UI updates nodes and the event log.
4. Closing the stream or finishing the run ends the EventSource.

No automatic retry on stream failure — operator hits Run again. Reset is the backoff / clear path.

## Controls

- Worker count slider (1–max available), disabled while running.
- Query text field, disabled while running.
- Threshold chips: merge tolerance (`CONFIDENCE_THRESHOLD`), R0 gate when deliberation is on, live R0 gate outcome badge.

## Merge and badges

- Tolerance badge: **ok** when `withinTolerance`, else **flagged**.
- Consensus copy names confidence % and `mergeStrategy`.
- Divergence copy tells the operator not to use the answer without human validation and exposes all worker outputs.
- Demo mode can mask remote models as on-device SLM names (`DEMO_EDGE_MODELS`); real models still run underneath.

## Focus

Primary actions are the query field and **Run simulation**. Keyboard: standard text input + button activation; no custom shortcuts.
