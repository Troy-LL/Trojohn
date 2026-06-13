import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Agent, CursorAgentError } from '@cursor/sdk';
import type { RoundInput, WorkerConfig, WorkerResult } from '../types.js';
import { BaseWorker, type CallOptions } from './base.js';

function phaseInstructions(phase: RoundInput['phase'], round: number): string {
  if (phase === 'question') {
    return `CRITICAL THINKING PHASE (before answering)
- Do NOT answer the query yet.
- List 2–4 sharp questions you would need clarified to answer well, based only on the user query.
- Surface hidden assumptions, scope boundaries, timeframe, definitions, and tradeoffs.
- One question per line. End each with "?".
- Keep the full list under 120 words.`;
  }
  if (phase === 'critique') {
    return `DELIBERATION PHASE: CRITIQUE (round ${round})
- You received peer proposals from round 0. Critique factual errors, weak reasoning, and missing caveats.
- Do not simply agree. Identify specific disagreements and gaps.
- Keep your response under 200 words.`;
  }
  return `DELIBERATION PHASE: REVISE (round ${round})
- You received peer proposals and critiques. Update your answer to resolve valid conflicts.
- Keep strong points from your prior reasoning when still correct.
- State what you changed and why. Keep your response under 200 words.`;
}

function buildPrompt(
  systemPrompt: string,
  query: string,
  context: string | undefined,
  roundInput?: RoundInput,
): string {
  const ctx = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  let peerSection = '';
  if (roundInput?.phase === 'question') {
    peerSection = `\n\n${phaseInstructions('question', roundInput.round)}`;
  } else if (roundInput && roundInput.peerOutputs.length > 0) {
    const blocks = roundInput.peerOutputs.map(
      (p) =>
        `[${p.messageType.toUpperCase()} from ${p.workerId.toUpperCase()} (${p.role})]\n${p.text}`,
    );
    peerSection = `\n\nPEER RESPONSES (round ${roundInput.round}):\n${blocks.join('\n\n')}\n\n${phaseInstructions(roundInput.phase, roundInput.round)}`;
  }
  let criticalSection = '';
  if (roundInput?.phase === 'propose' && roundInput.criticalQuestions?.length) {
    const numbered = roundInput.criticalQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
    criticalSection = `\n\nCRITICAL QUESTIONS TO ADDRESS IN YOUR PROPOSAL:\n${numbered}\n- Explicitly resolve or acknowledge each question in your answer.\n`;
  }
  return `${systemPrompt}${peerSection}${criticalSection}\n\n---\n\nQUERY:\n${query}${ctx}`;
}

/**
 * One worker = one isolated Cursor agent run against an empty sandbox
 * directory. All model families go through this single class; the role and
 * model come from config.
 */
export class CursorWorker extends BaseWorker {
  constructor(
    config: WorkerConfig,
    private readonly apiKey: string,
    private readonly sandboxRoot: string,
  ) {
    super(config);
  }

  async call(
    query: string,
    context: string | undefined,
    options?: CallOptions,
  ): Promise<WorkerResult> {
    const round = options?.roundInput?.round ?? 0;
    const start = Date.now();
    const base = {
      workerId: this.config.id,
      role: this.config.role,
      voter: this.config.voter,
      model: this.config.model,
      round,
    };

    const sandbox = path.join(this.sandboxRoot, this.config.id);
    mkdirSync(sandbox, { recursive: true });

    let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
    let timedOut = false;
    let output = '';

    try {
      agent = await Agent.create({
        apiKey: this.apiKey,
        model: { id: this.config.model },
        local: { cwd: sandbox },
      });

      const run = await agent.send(
        buildPrompt(this.config.systemPrompt, query, context, options?.roundInput),
      );
      options?.hooks?.onStart?.();

      const timer = setTimeout(() => {
        timedOut = true;
        if (run.supports('cancel')) {
          void run.cancel().catch(() => {});
        }
      }, this.config.timeoutMs);

      let result: { status: string };
      try {
        for await (const event of run.stream()) {
          if (event.type === 'assistant') {
            for (const block of event.message.content) {
              if (block.type === 'text' && block.text) {
                output += block.text;
                options?.hooks?.onToken?.(block.text);
              }
            }
          }
        }
        result = await run.wait();
      } finally {
        clearTimeout(timer);
      }

      if (timedOut) {
        return {
          ...base,
          output: output.trim(),
          latencyMs: Date.now() - start,
          status: 'timeout',
          errorMessage: `exceeded ${this.config.timeoutMs}ms`,
        };
      }

      if (result.status !== 'finished' && result.status !== 'completed') {
        return {
          ...base,
          output: output.trim(),
          latencyMs: Date.now() - start,
          status: 'error',
          errorMessage: `run ended with status "${result.status}"`,
        };
      }

      return {
        ...base,
        output: output.trim(),
        latencyMs: Date.now() - start,
        status: 'success',
      };
    } catch (err) {
      if (timedOut) {
        return {
          ...base,
          output: output.trim(),
          latencyMs: Date.now() - start,
          status: 'timeout',
          errorMessage: `exceeded ${this.config.timeoutMs}ms`,
        };
      }
      const errorMessage =
        err instanceof CursorAgentError
          ? `startup failed: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        ...base,
        output: output.trim(),
        latencyMs: Date.now() - start,
        status: 'error',
        errorMessage,
      };
    } finally {
      if (agent) {
        try {
          await agent[Symbol.asyncDispose]();
        } catch {
          // disposal failures are non-fatal
        }
      }
    }
  }
}
