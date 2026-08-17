# AGENTS

Load ceiling: this file + at most 2 extras (or +3 when the turn needs eval). Skip unused.

- **Run / install / ports** → [`README.md`](README.md); package detail → [`orchestrator-mvp/README.md`](orchestrator-mvp/README.md)
- **Topology, transport, merge flow** → [`docs/architecture.md`](docs/architecture.md); contracts → [`orchestrator-mvp/src/types.ts`](orchestrator-mvp/src/types.ts), [`orchestrator-mvp/src/transport/types.ts`](orchestrator-mvp/src/transport/types.ts)
- **Mesh UI copy, SSE run loop, badges** → [`docs/design.md`](docs/design.md)
- **Eval gold command and live probes** → [`docs/eval.md`](docs/eval.md)

## Commands

Work in `orchestrator-mvp/` unless editing root docs.

```bash
cd orchestrator-mvp
npm test
npm run build
node ./node_modules/typescript/bin/tsc --noEmit
```

Server: `npm run server` (port `3000`). Do not invent `spec.md` / `plan.md` / `tasks.md` trees.

## Thinking = council, never solo

Any thinking, brainstorming, design, feasibility call, or architecture decision runs as a **parallel subagent council**, not as one model reasoning alone. Non-negotiable. Writing code from a settled decision is exempt; deciding *what* to build is not.

**Triggers.** "Should we…", "is X feasible", "how do we design…", "what's the best approach", picking between architectures, evaluating a claim, planning a phase, reading a paper or product to decide if it applies here. If a turn would otherwise produce a recommendation from one perspective, it is a council turn.

**Standing personas.** Spawn in one message so they run concurrently. Pick the relevant subset, minimum four, and always include the devil's advocate:

- **Devil's advocate** — mandatory in every council, never optional, never merged into another role. Its job is to kill the idea, not soften it.
- **AI researcher** — prior art, what the literature already claims, is this novel
- **AI engineer** — does the mechanism work, does the code measure what it claims
- **Data engineer** — schema, reproducibility, cost, what the numbers would even be
- **Mobile / distributed systems** — physical limits: thermal, battery, memory, NAT, churn
- Add ad-hoc personas when the subject needs them (economics, security, product, UX). Name the lens, not the job title.

**Rules of order.**

- **Delegate, don't summarize.** Each persona gets its own scope and returns its own findings. Do not pre-digest the question into an answer and ask agents to agree with it.
- **Evidence or it doesn't count.** Every persona backs claims with web-searched literature, real vendor pricing, or a command it actually ran — with links, versions, and numbers. Vibes are rejected findings.
- **Run the cheap test.** If a claim can be settled by a script in under an hour, run it that turn instead of arguing about it. Free falsifying tests come before all paid ones.
- **Devil's advocate gets the last pass.** Before any recommendation ships, it re-attacks the synthesized conclusion, not just the original idea.
- **Disagreement survives.** Report where personas conflict. Never flatten a live dispute into false consensus.

**Looping.** A council round ends by emitting falsifiable claims with predictions committed in advance, plus the cheapest test that kills each. Loop again when a test result lands, a persona's finding invalidates another's premise, or the devil's advocate's last pass opens something unanswered. Stop when every open claim is either tested or blocked on a named external dependency — not when the answer merely feels complete.

**Never** ship a design decision, feasibility verdict, or research claim from a single perspective, and never let a council conclusion rest on an untested premise nobody was assigned to attack.

## Never

- Do not add per-provider LLM SDKs; workers stay on `@cursor/sdk` (+ Ollama / remote mesh).
- Do not bypass the transport bus for deliberation (no direct worker-to-worker calls).
- Do not commit `.env` or secrets.
- On Windows, keep npm scripts as `node node_modules/...` entrypoints when the repo path contains `&`.

## Scratch

Park hypotheses and spikes under `scratch/` (gitignored). Do not map scratch. Promote into an owner or delete.
