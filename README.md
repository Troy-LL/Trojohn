# Trojohn

Phones as a compute mesh. Several small models, one orchestrator, a single answer.

The bet is you can rent thinking from phones instead of buying another box. The MVP in `orchestrator-mvp/` runs the deliberation pipeline locally (propose, critique, revise) with Cursor workers, a local Ollama worker, and optional phone nodes.

## Run

```bash
cd orchestrator-mvp
npm install
npm run server
```

The original idea is in [rawidea.md](rawidea.md). The implemented pipeline is in [spec.md](spec.md).
