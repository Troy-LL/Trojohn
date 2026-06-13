import type { WorkerConfig, WorkerResult } from '../types.js';
import { BaseWorker, type CallOptions } from './base.js';

function phaseInstructions(phase: 'critique' | 'revise'): string {
  if (phase === 'critique') {
    return `DELIBERATION PHASE: CRITIQUE
- Critique peer proposals for factual errors, weak reasoning, and missing caveats.
- Identify specific disagreements. Keep under 200 words.`;
  }
  return `DELIBERATION PHASE: REVISE
- Update your answer using peer proposals and critiques. Resolve valid conflicts.
- Keep under 200 words.`;
}

function buildPrompt(
  systemPrompt: string,
  query: string,
  context: string | undefined,
  options?: CallOptions,
): string {
  const ctx = context ? `\n\nADDITIONAL CONTEXT:\n${context}` : '';
  let peerSection = '';
  const roundInput = options?.roundInput;
  if (roundInput && roundInput.peerOutputs.length > 0 && roundInput.phase !== 'propose') {
    const blocks = roundInput.peerOutputs.map(
      (p) =>
        `[${p.messageType.toUpperCase()} from ${p.workerId.toUpperCase()} (${p.role})]\n${p.text}`,
    );
    peerSection = `\n\nPEER RESPONSES:\n${blocks.join('\n\n')}\n\n${phaseInstructions(roundInput.phase)}`;
  }
  return `${systemPrompt}${peerSection}\n\n---\n\nQUERY:\n${query}${ctx}`;
}

interface OllamaChatResponse {
  message?: { content?: string };
  done?: boolean;
}

/**
 * Local SLM worker via Ollama's chat API. Same WorkerResult contract as CursorWorker.
 */
export class OllamaWorker extends BaseWorker {
  constructor(
    config: WorkerConfig,
    private readonly ollamaUrl: string,
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const res = await fetch(`${this.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          stream: true,
          messages: [
            {
              role: 'user',
              content: buildPrompt(this.config.systemPrompt, query, context, options),
            },
          ],
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        return {
          ...base,
          output: '',
          latencyMs: Date.now() - start,
          status: 'error',
          errorMessage: `ollama ${res.status}: ${text}`,
        };
      }

      if (!res.body) {
        return {
          ...base,
          output: '',
          latencyMs: Date.now() - start,
          status: 'error',
          errorMessage: 'ollama returned empty body',
        };
      }

      options?.hooks?.onStart?.();
      let output = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line) as OllamaChatResponse;
            const text = chunk.message?.content ?? '';
            if (text) {
              output += text;
              options?.hooks?.onToken?.(text);
            }
          } catch {
            // ignore malformed stream chunks
          }
        }
      }

      return {
        ...base,
        output: output.trim(),
        latencyMs: Date.now() - start,
        status: 'success',
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ...base,
        output: '',
        latencyMs: Date.now() - start,
        status: aborted ? 'timeout' : 'error',
        errorMessage: aborted
          ? `exceeded ${this.config.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
