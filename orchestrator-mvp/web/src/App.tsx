import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownPreview } from './MarkdownPreview';
import './App.css';

type WorkerState = {
  id: string;
  role: string;
  model: string;
  text: string;
  status: 'idle' | 'running' | 'done' | 'error';
  round: number;
  phase?: string;
};

type RoundSummaryView = {
  round: number;
  phase: string;
  confidence: number;
  earlyExit?: boolean;
  judgeConfidence?: number;
};

type ArtifactView = {
  acceptedClaims: Array<{ id: string; text: string; status: string; confidence: number }>;
  disputedClaims: Array<{ id: string; text: string; status: string; confidence: number }>;
  summary: string;
};

type FinalResult = {
  finalOutput: string;
  confidence: number;
  withinTolerance: boolean;
  mergeStrategy: string;
  totalLatencyMs: number;
  r0Gate?: string;
  rounds?: RoundSummaryView[];
  artifact?: ArtifactView;
  judgeVerdict?: { confidence: number; conflicts?: string[] };
};

type LogLine = {
  id: number;
  time: string;
  text: string;
  tone: 'info' | 'success' | 'warn' | 'error';
};

type Health = {
  workers: string[];
  maxWorkers: number;
  confidenceThreshold: number;
  r0GateThreshold?: number;
  deliberationRounds: number;
  criticalThinking?: boolean;
  similarityMode?: string;
  scratchpadMode?: string;
  transport: string;
  demoEdgeModels?: boolean;
  meshNodes?: number;
  models: Array<{ name: string; model: string }>;
};

const WORKER_META: Record<
  string,
  { label: string; subtitle: string }
> = {
  factual: { label: 'Factual retrieval', subtitle: 'Verifiable facts only' },
  reasoning: { label: 'Reasoning chain', subtitle: 'Step-by-step inference' },
  advocate: { label: "Devil's advocate", subtitle: 'Edge cases & counterpoints' },
  local: { label: 'Local SLM node', subtitle: 'On-device Ollama worker' },
};

const WORKER_ORDER = ['factual', 'reasoning', 'advocate', 'local'] as const;

function shortModel(model: string): string {
  if (!model) return '—';
  const tag = model.split(':')[0];
  return tag.replace(/-\d[\d.-]*/g, '').replace(/^claude-/, 'claude-');
}

function nowTime(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function formatRoundBadge(round: number): string {
  if (round === -1) return 'Q';
  return `R${round}`;
}

function PhoneWorker({
  id,
  worker,
  modelHint,
}: {
  id: string;
  worker?: WorkerState;
  modelHint?: string;
}) {
  const meta = WORKER_META[id] ?? { label: id, subtitle: '' };
  const status = worker?.status ?? 'idle';
  const model = worker?.model || modelHint || '—';

  return (
    <div className={`phone-worker ${status}`}>
      <div className="phone-frame">
        <div className="phone-notch" />
        <div className="phone-screen">
          <span className="phone-role">{meta.label}</span>
          <span className="phone-model">{shortModel(model)}</span>
          {worker && worker.status !== 'idle' && (
            <span className="phone-round" title={worker.phase ?? undefined}>
              {formatRoundBadge(worker.round)}
            </span>
          )}
          {status === 'running' && <span className="phone-pulse">running…</span>}
          {status === 'done' && (
            <span className="phone-done">
              <span className="check">✓</span> done
            </span>
          )}
          {status === 'error' && <span className="phone-error">error</span>}
          {status === 'idle' && <span className="phone-idle">idle</span>}
        </div>
      </div>
      <div className="phone-caption">
        <strong>{meta.label}</strong>
        <span>{shortModel(model)}</span>
      </div>
    </div>
  );
}

function App() {
  const [query, setQuery] = useState('Is TypeScript better than JS?');
  const [workerCount, setWorkerCount] = useState<number>(3);
  const [maxWorkers, setMaxWorkers] = useState<number>(WORKER_ORDER.length);
  const [threshold, setThreshold] = useState(0.72);
  const [r0GateThreshold, setR0GateThreshold] = useState(0.85);
  const [modelHints, setModelHints] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [judgeConfidence, setJudgeConfidence] = useState<number | null>(null);
  const [r0Gate, setR0Gate] = useState<string | null>(null);
  const [criticalQuestions, setCriticalQuestions] = useState<string[]>([]);
  const [artifact, setArtifact] = useState<ArtifactView | null>(null);
  const [final, setFinal] = useState<FinalResult | null>(null);
  const [workers, setWorkers] = useState<Record<string, WorkerState>>({});
  const [roundSummaries, setRoundSummaries] = useState<RoundSummaryView[]>([]);
  const [deliberationRounds, setDeliberationRounds] = useState(0);
  const [criticalThinking, setCriticalThinking] = useState(false);
  const [transport, setTransport] = useState('inprocess');
  const [meshNodes, setMeshNodes] = useState(0);
  const [scratchpadMode, setScratchpadMode] = useState('off');
  const [demoEdgeModels, setDemoEdgeModels] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const logId = useRef(0);
  const consoleRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((text: string, tone: LogLine['tone'] = 'info') => {
    logId.current += 1;
    setLogs((prev) => [...prev, { id: logId.current, time: nowTime(), text, tone }]);
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: Health) => {
        const max = h.maxWorkers || h.workers.length || WORKER_ORDER.length;
        setMaxWorkers(max);
        setWorkerCount((prev) => Math.min(Math.max(prev, 1), max));
        setThreshold(h.confidenceThreshold);
        setR0GateThreshold(h.r0GateThreshold ?? 0.85);
        setDeliberationRounds(h.deliberationRounds ?? 0);
        setCriticalThinking(h.criticalThinking ?? false);
        setTransport(h.transport ?? 'inprocess');
        setMeshNodes(h.meshNodes ?? 0);
        setScratchpadMode(h.scratchpadMode ?? 'off');
        setDemoEdgeModels(h.demoEdgeModels ?? false);
        const hints: Record<string, string> = {};
        for (const m of h.models) {
          const id = m.name.replace('worker:', '');
          if (WORKER_META[id]) hints[id] = m.model;
        }
        setModelHints(hints);
        const mode = h.demoEdgeModels ? 'edge SLM display' : 'live model IDs';
        appendLog(
          `Orchestrator ready — ${max} workers, transport=${h.transport ?? 'inprocess'}, ${mode}`,
          'info',
        );
        if ((h.deliberationRounds ?? 0) > 0) {
          appendLog(
            `CLM deliberation: up to ${h.deliberationRounds} follow-up round(s)${h.criticalThinking ? ' + critical question round' : ''}`,
            'info',
          );
        } else {
          appendLog('Deliberation OFF (DELIBERATION_ROUNDS=0) — workers run propose once only', 'warn');
        }
      })
      .catch(() => appendLog('Server offline — run npm run server', 'error'));
  }, [appendLog]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  const selectedWorkerIds = useMemo(
    () => WORKER_ORDER.slice(0, Math.min(workerCount, maxWorkers)),
    [workerCount, maxWorkers],
  );

  const activeCount = useMemo(
    () => Object.values(workers).filter((w) => w.status === 'running').length,
    [workers],
  );

  const completedCount = useMemo(
    () => Object.values(workers).filter((w) => w.status === 'done').length,
    [workers],
  );

  const reset = useCallback(() => {
    setRunning(false);
    setWorkers({});
    setRoundSummaries([]);
    setFinal(null);
    setConfidence(null);
    setJudgeConfidence(null);
    setR0Gate(null);
    setCriticalQuestions([]);
    setArtifact(null);
    appendLog('Reset — cleared session state', 'info');
  }, [appendLog]);

  const runQuery = useCallback(async () => {
    if (!query.trim() || running) return;
    setRunning(true);
    setFinal(null);
    setConfidence(null);
    setJudgeConfidence(null);
    setR0Gate(null);
    setCriticalQuestions([]);
    setArtifact(null);
    setWorkers({});
    setRoundSummaries([]);

    appendLog(`Query: "${query.trim()}"`, 'info');
    appendLog(`Dispatching ${selectedWorkerIds.length} worker(s)…`, 'info');

    const sessionId = crypto.randomUUID();
    const es = new EventSource(`/api/events?sessionId=${sessionId}`);

    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as {
        type: string;
        round?: number;
        payload: Record<string, unknown>;
      };

      if (msg.type === 'worker_started') {
        const p = msg.payload as { workerId: string; model: string; role: string; phase?: string };
        const round = msg.round ?? 0;
        const label = WORKER_META[p.workerId]?.label ?? p.workerId;
        appendLog(
          `Worker [${label}] round ${round}${p.phase ? ` (${p.phase})` : ''} started (${shortModel(p.model)})`,
          'info',
        );
        setWorkers((prev) => ({
          ...prev,
          [p.workerId]: {
            id: p.workerId,
            role: p.role,
            model: p.model,
            text: '',
            status: 'running',
            round,
            phase: p.phase,
          },
        }));
      }

      if (msg.type === 'worker_token') {
        const p = msg.payload as { workerId: string; chunk: string };
        const round = msg.round ?? 0;
        if (p.workerId === 'judge') return;
        setWorkers((prev) => {
          const cur = prev[p.workerId];
          const base = cur ?? {
            id: p.workerId,
            role: p.workerId,
            model: '',
            text: '',
            status: 'running' as const,
            round,
          };
          const text = base.round === round ? base.text + p.chunk : p.chunk;
          return {
            ...prev,
            [p.workerId]: { ...base, text, status: 'running', round, phase: base.phase },
          };
        });
      }

      if (msg.type === 'worker_done') {
        const p = msg.payload as {
          workerId: string;
          role: string;
          model: string;
          output: string;
          status: string;
          round?: number;
        };
        const round = p.round ?? msg.round ?? 0;
        const label = WORKER_META[p.workerId]?.label ?? p.workerId;
        const ok = p.status === 'success';
        appendLog(
          `Worker ${selectedWorkerIds.indexOf(p.workerId as typeof WORKER_ORDER[number]) + 1} [${label}] ${ok ? 'completed' : 'failed'}`,
          ok ? 'success' : 'error',
        );
        setWorkers((prev) => ({
          ...prev,
          [p.workerId]: {
            id: p.workerId,
            role: p.role,
            model: p.model,
            text: p.output,
            status: ok ? 'done' : 'error',
            round,
          },
        }));
      }

      if (msg.type === 'similarity_scores') {
        const p = msg.payload as {
          confidence: number;
          phase?: string;
          earlyExit?: boolean;
          final?: boolean;
          criticalQuestions?: string[];
        };
        const round = msg.round ?? 0;
        if (p.criticalQuestions?.length) setCriticalQuestions(p.criticalQuestions);
        if (!p.final) {
          setRoundSummaries((prev) => {
            const next = prev.filter((r) => r.round !== round);
            return [
              ...next,
              {
                round,
                phase: p.phase ?? (round === -1 ? 'question' : round === 0 ? 'propose' : 'revise'),
                confidence: p.confidence,
                earlyExit: p.earlyExit,
              },
            ].sort((a, b) => a.round - b.round);
          });
        }
        setConfidence(p.confidence);
        const pct = Math.round(p.confidence * 100);
        const tol = p.confidence >= threshold;
        if (!p.final) {
          appendLog(
            `Round ${round}: confidence ${pct}%${p.earlyExit ? ' — early exit' : ''}`,
            tol ? 'success' : 'warn',
          );
        } else {
          appendLog(
            `Merge: confidence ${pct}% ${tol ? '≥' : '<'} ${Math.round(threshold * 100)}% — WITHIN_TOLERANCE: ${tol ? 'YES' : 'NO'}`,
            tol ? 'success' : 'warn',
          );
        }
      }

      if (msg.type === 'judge_started') {
        appendLog('Merge judge invoked — synthesizing outputs…', 'warn');
      }

      if (msg.type === 'judge_verdict') {
        const p = msg.payload as { confidence?: number };
        if (typeof p.confidence === 'number') setJudgeConfidence(p.confidence);
        appendLog(`Judge verdict received (${Math.round((p.confidence ?? 0) * 100)}%)`, 'info');
      }

      if (msg.type === 'scratchpad_update') {
        const p = msg.payload as { artifact?: ArtifactView };
        if (p.artifact) setArtifact(p.artifact);
      }

      if (msg.type === 'final') {
        const p = msg.payload as FinalResult;
        setFinal(p);
        if (p.rounds?.length) setRoundSummaries(p.rounds);
        setConfidence(p.confidence);
        if (p.r0Gate) setR0Gate(p.r0Gate);
        if (p.judgeVerdict?.confidence != null) setJudgeConfidence(p.judgeVerdict.confidence);
        if (p.artifact) setArtifact(p.artifact);
        const pct = Math.round(p.confidence * 100);
        appendLog(
          p.withinTolerance
            ? `Final answer accepted (${pct}% confidence, ${p.mergeStrategy})`
            : `Workers diverged (${pct}% confidence) — outputs flagged for review`,
          p.withinTolerance ? 'success' : 'warn',
        );
        setRunning(false);
        es.close();
      }

      if (msg.type === 'error') {
        appendLog(String((msg.payload as { message: string }).message), 'error');
        setRunning(false);
        es.close();
      }
    };

    es.addEventListener('done', () => es.close());

    try {
      const res = await fetch('/api/run/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), sessionId, workerIds: selectedWorkerIds }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? res.statusText);
      }
    } catch (err) {
      appendLog(err instanceof Error ? err.message : String(err), 'error');
      setRunning(false);
      es.close();
    }
  }, [query, running, selectedWorkerIds, threshold, appendLog]);

  const confPct = confidence != null ? Math.round(confidence * 100) : null;
  const toleranceLabel =
    final != null ? (final.withinTolerance ? 'YES' : 'NO') : confPct != null && confPct >= threshold * 100 ? 'YES' : confPct != null ? 'NO' : '—';

  const mergeMessage = final
    ? final.withinTolerance
      ? `Consensus reached (${confPct}% confidence). Strategy: ${final.mergeStrategy}.`
      : `Workers diverged (confidence ${confPct}% < ${Math.round(threshold * 100)}%). Exposing all ${completedCount} outputs for review — do not use without human validation.`
    : running
      ? 'Waiting for workers to complete…'
      : 'Run a simulation to merge worker outputs.';

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <h1>Orchestrator MVP</h1>
          <div className="demo-badges">
            {demoEdgeModels && <span className="demo-badge edge">edge SLM</span>}
            {deliberationRounds > 0 && (
              <span className="demo-badge rounds">
                ≤{deliberationRounds} rounds{criticalThinking ? ' + Q' : ''}
              </span>
            )}
            {deliberationRounds === 0 && (
              <span className="demo-badge single-shot">single-shot</span>
            )}
            {transport === 'simulated' && (
              <span className="demo-badge mesh">simulated mesh</span>
            )}
            {transport === 'webrtc' && (
              <span className="demo-badge mesh">webrtc mesh ({meshNodes} nodes)</span>
            )}
            {scratchpadMode === 'parallel' && (
              <span className="demo-badge scratchpad">scratchpad</span>
            )}
          </div>
        </div>
        <p>Multi-model sandbox mesh — simulated phone nodes</p>
      </header>

      <section className="control-bar">
        <div className="control-group workers-control">
          <label htmlFor="workers">
            Workers <span className="slider-hint">1–{maxWorkers}</span>
          </label>
          <div className="slider-row">
            <input
              id="workers"
              type="range"
              min={1}
              max={maxWorkers}
              step={1}
              value={Math.min(workerCount, maxWorkers)}
              onChange={(e) => setWorkerCount(Number(e.target.value))}
              disabled={running}
            />
            <span className="slider-value">{Math.min(workerCount, maxWorkers)}</span>
          </div>
        </div>

        <div className="control-group query-control">
          <label htmlFor="query">Query</label>
          <input
            id="query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type any question or prompt…"
            disabled={running}
          />
        </div>

        <div className="control-actions">
          <button
            type="button"
            className="btn-run"
            disabled={running || !query.trim()}
            onClick={() => void runQuery()}
          >
            Run simulation ↗
          </button>
          <button type="button" className="btn-reset" disabled={running} onClick={reset}>
            Reset
          </button>
        </div>
      </section>

      <section className="thresholds-panel">
        <span className="threshold-chip">Merge tolerance: {Math.round(threshold * 100)}%</span>
        {deliberationRounds > 0 && (
          <span className="threshold-chip">R0 gate: {Math.round(r0GateThreshold * 100)}%</span>
        )}
        {r0Gate && r0Gate !== 'n/a' && (
          <span className={`threshold-chip gate-${r0Gate}`}>R0 gate: {r0Gate}</span>
        )}
        {judgeConfidence != null && (
          <span className="threshold-chip">Judge: {Math.round(judgeConfidence * 100)}%</span>
        )}
      </section>

      <section className="stat-cards">
        <div className="stat-card">
          <span className="stat-label">Active workers</span>
          <span className="stat-value">{activeCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Completed</span>
          <span className="stat-value">{completedCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Confidence</span>
          <span className="stat-value">{confPct != null ? `${confPct}%` : '—'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Tolerance</span>
          <span className={`stat-value ${toleranceLabel === 'NO' ? 'bad' : toleranceLabel === 'YES' ? 'good' : ''}`}>
            {toleranceLabel}
          </span>
        </div>
      </section>

      {roundSummaries.length > 0 && (
        <section className="rounds-panel">
          <h2>Deliberation rounds{deliberationRounds > 0 ? ` (max ${deliberationRounds})` : ''}</h2>
          <div className="rounds-grid">
            {roundSummaries.map((r) => (
              <div key={r.round} className={`round-chip ${r.earlyExit ? 'early' : ''}`}>
                <span className="round-chip-label">{r.round === -1 ? 'Q' : `R${r.round}`} · {r.phase}</span>
                {r.phase !== 'question' && (
                  <span className="round-chip-conf">vote {Math.round(r.confidence * 100)}%</span>
                )}
                {r.judgeConfidence != null && (
                  <span className="round-chip-judge">judge {Math.round(r.judgeConfidence * 100)}%</span>
                )}
                {r.earlyExit && <span className="round-chip-exit">early exit</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {criticalQuestions.length > 0 && (
        <section className="questions-panel">
          <h2>Critical questions (Q round)</h2>
          <ul>
            {criticalQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      {artifact && (artifact.acceptedClaims.length > 0 || artifact.disputedClaims.length > 0) && (
        <section className="scratchpad-panel">
          <h2>Scratchpad claims</h2>
          <div className="claims-grid">
            {artifact.acceptedClaims.map((c) => (
              <div key={c.id} className={`claim-chip status-${c.status}`}>
                <span className="claim-id">{c.id}</span>
                <span className="claim-text">{c.text}</span>
                <span className="claim-meta">{c.status} · {Math.round(c.confidence * 100)}%</span>
              </div>
            ))}
            {artifact.disputedClaims.map((c) => (
              <div key={c.id} className="claim-chip status-disputed">
                <span className="claim-id">{c.id}</span>
                <span className="claim-text">{c.text}</span>
                <span className="claim-meta">disputed</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="phones-row">
        {selectedWorkerIds.map((id) => (
          <PhoneWorker key={id} id={id} worker={workers[id]} modelHint={modelHints[id]} />
        ))}
      </section>

      <section className={`merge-panel ${final?.withinTolerance === false ? 'flagged' : final?.withinTolerance ? 'ok' : ''}`}>
        <div className="merge-header">
          <h2>Merge + validator</h2>
          {final && (
            <span className={`merge-badge ${final.withinTolerance ? 'ok' : 'flagged'}`}>
              {final.withinTolerance ? 'consensus' : 'diverged — flagged'}
            </span>
          )}
        </div>
        <div className="merge-bar">
          <div
            className="merge-bar-fill"
            style={{
              width: `${confPct ?? 0}%`,
              background:
                confPct == null
                  ? '#30363d'
                  : confPct >= threshold * 100
                    ? '#3fb950'
                    : confPct >= threshold * 100 * 0.5
                      ? '#d29922'
                      : '#f85149',
            }}
          />
        </div>
        <p className="merge-message">{mergeMessage}</p>
        {final && (
          <div className="merge-answer">
            <strong>Final answer</strong>
            <MarkdownPreview content={final.finalOutput} className="merge-answer-body" />
          </div>
        )}
      </section>

      {Object.keys(workers).length > 0 && (
        <section className="outputs-panel">
          <h2>Worker outputs</h2>
          <div className="outputs-grid">
            {selectedWorkerIds.map((id) => {
              const w = workers[id];
              if (!w?.text) return null;
              return (
                <details key={id} open={!!final && !final.withinTolerance}>
                  <summary>{WORKER_META[id]?.label ?? id}</summary>
                  <MarkdownPreview content={w.text} className="worker-output-body" />
                </details>
              );
            })}
          </div>
        </section>
      )}

      <section className="console-panel">
        <h2>Console</h2>
        <div className="console" ref={consoleRef}>
          {logs.map((line) => (
            <div key={line.id} className={`log-line log-${line.tone}`}>
              <span className="log-time">[{line.time}]</span> {line.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
