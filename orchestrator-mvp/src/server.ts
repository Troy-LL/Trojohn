import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';
import { maskModelForDemo } from './demoDisplay.js';
import { checkModelHealth, modelHealthFromConfig } from './registry.js';
import { Orchestrator } from './orchestrator.js';
import { initDb, listWorkers } from './store/sqlite.js';
import { ensureMeshHub, getMeshHub } from './transport/factory.js';
import type { OrchestratorRequest } from './types.js';
import type { Message } from './transport/types.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function maskMessageForDemo(msg: Message): Message {
  const payload = { ...msg.payload };
  if (msg.type === 'worker_started' && typeof payload.workerId === 'string') {
    payload.model = maskModelForDemo(payload.workerId, String(payload.model ?? ''));
  }
  if (msg.type === 'worker_done' && typeof payload.workerId === 'string') {
    payload.model = maskModelForDemo(payload.workerId, String(payload.model ?? ''));
  }
  return { ...msg, payload };
}

export async function startServer(cfg: AppConfig): Promise<void> {
  initDb(cfg.dbPath);
  ensureMeshHub(cfg);

  const app = express();
  app.use(express.json());

  const orchestrator = new Orchestrator(cfg);
  let health;
  try {
    health = await checkModelHealth(cfg);
  } catch (err) {
    console.warn(
      'Model health check failed — starting anyway:',
      err instanceof Error ? err.message : err,
    );
    health = modelHealthFromConfig(cfg);
  }
  const bad = health.filter((h) => !h.ok);
  if (bad.length) {
    console.warn('Unknown model IDs (calls may fail):', bad.map((b) => `${b.name}=${b.model}`).join(', '));
  }

  app.get('/api/health', (_req, res) => {
    const workerIds = orchestrator.getWorkerIds();
    const models = cfg.demoEdgeModels
      ? health.map((h) => {
          const id = h.name.replace('worker:', '');
          return { ...h, model: maskModelForDemo(id, h.model) };
        })
      : health;
    res.json({
      ok: true,
      workers: workerIds,
      maxWorkers: workerIds.length,
      models,
      confidenceThreshold: cfg.confidenceThreshold,
      r0GateThreshold: cfg.r0GateThreshold,
      deliberationRounds: cfg.deliberationRounds,
      criticalThinking: cfg.criticalThinking && cfg.deliberationRounds > 0,
      similarityMode: cfg.similarityMode,
      scratchpadMode: cfg.scratchpadMode,
      transport: cfg.transport,
      demoEdgeModels: cfg.demoEdgeModels,
      meshNodes: getMeshHub()?.getConnectedNodes().length ?? 0,
    });
  });

  app.get('/api/workers', (_req, res) => {
    const meshHub = getMeshHub();
    res.json({
      connected: meshHub?.getConnectedNodes() ?? [],
      registry: listWorkers(),
    });
  });

  /** Subscribe before POST /api/run/stream — pass the same sessionId in the body. */
  app.get('/api/events', (req, res) => {
    const sessionId = String(req.query.sessionId ?? '');
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId query param required' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsub = orchestrator.transport.subscribe((msg) => {
      if (msg.sessionId !== sessionId) return;
      const out = cfg.demoEdgeModels ? maskMessageForDemo(msg) : msg;
      res.write(`data: ${JSON.stringify(out)}\n\n`);
      if (msg.type === 'final' || msg.type === 'error') {
        res.write('event: done\ndata: {}\n\n');
      }
    });

    req.on('close', () => unsub());
  });

  app.post('/api/run/stream', async (req, res) => {
    try {
      const body = req.body as OrchestratorRequest;
      if (!body?.query?.trim()) {
        res.status(400).json({ error: 'query is required' });
        return;
      }
      const result = await orchestrator.run(body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/run', async (req, res) => {
    try {
      const body = req.body as OrchestratorRequest;
      if (!body?.query?.trim()) {
        res.status(400).json({ error: 'query is required' });
        return;
      }
      const result = await orchestrator.run(body);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  const webDist = path.join(projectRoot, 'web', 'dist');
  app.use(express.static(webDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'), (err) => {
      if (err) res.status(200).send(fallbackHtml(cfg.port));
    });
  });

  app.listen(cfg.port, () => {
    console.log(`Orchestrator server http://localhost:${cfg.port}`);
    console.log(`Workers: ${orchestrator.getWorkerIds().join(', ')}`);
  });
}

function fallbackHtml(port: number): string {
  return `<!DOCTYPE html><html><body style="font-family:system-ui;background:#0f1117;color:#e6edf3;padding:2rem">
<h1>Orchestrator MVP</h1>
<p>Web UI not built yet. Run <code>npm run web:build</code> or use the API:</p>
<pre>curl -X POST http://localhost:${port}/api/run -H "Content-Type: application/json" -d "{\\"query\\":\\"What causes inflation?\\"}"</pre>
</body></html>`;
}
