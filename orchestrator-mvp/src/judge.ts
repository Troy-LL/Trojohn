import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { Agent, CursorAgentError } from '@cursor/sdk';
import type { JudgeVerdict, RoundSummary, WorkerResult } from './types.js';

const JUDGE_SYSTEM = `You are the Merge Judge in a distributed CLM (Composite Language Model) system.

You receive outputs from isolated workers who each answered the same query independently, possibly across multiple deliberation rounds.
Synthesize one final answer and return ONLY valid JSON (no markdown fences) with this shape:
{
  "finalAnswer": "string",
  "confidence": 0.0 to 1.0,
  "conflicts": ["list of direct contradictions, or empty array"],
  "reasoning": "brief synthesis notes"
}

Rules:
- Points all factual/reasoning workers agree on → high confidence.
- Points only one worker raised → lower confidence unless compelling.
- Include the devil's advocate critique when it surfaces real conflicts.
- When deliberation rounds are present, weight later revisions over initial proposals.
- Format finalAnswer using markdown (bold section headers, numbered/bulleted lists) for readability.
- Do not use tools. Answer directly.`;

function buildDeliberationTrace(allResults: WorkerResult[], rounds: RoundSummary[]): string {
  if (rounds.length <= 1) return '';

  const lines: string[] = ['\n\nDELIBERATION TRACE:'];
  for (const summary of rounds) {
    lines.push(`\n--- Round ${summary.round} (${summary.phase}, confidence ${(summary.confidence * 100).toFixed(0)}%) ---`);
    const roundOutputs = allResults.filter((r) => r.round === summary.round && r.status === 'success');
    for (const r of roundOutputs) {
      lines.push(`\n### ${r.workerId.toUpperCase()} (${r.role})\n${r.output}`);
    }
  }
  return lines.join('\n');
}

function buildJudgePrompt(
  query: string,
  results: WorkerResult[],
  allResults: WorkerResult[],
  rounds: RoundSummary[],
): string {
  const blocks = results
    .filter((r) => r.status === 'success' && r.output)
    .map((r) => `### Worker ${r.workerId.toUpperCase()} (${r.role}, model: ${r.model}, round ${r.round})\n${r.output}`)
    .join('\n\n');
  const trace = buildDeliberationTrace(allResults, rounds);
  return `${JUDGE_SYSTEM}\n\n---\n\nQUERY:\n${query}\n\nFINAL ROUND WORKER OUTPUTS:\n${blocks}${trace}`;
}

function parseVerdict(raw: string): JudgeVerdict {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('judge returned no JSON object');
  const parsed = JSON.parse(jsonMatch[0]) as {
    finalAnswer?: string;
    confidence?: number;
    conflicts?: string[];
    reasoning?: string;
  };
  if (!parsed.finalAnswer || typeof parsed.confidence !== 'number') {
    throw new Error('judge JSON missing required fields');
  }
  return {
    finalAnswer: parsed.finalAnswer,
    confidence: Math.min(1, Math.max(0, parsed.confidence)),
    conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    reasoning: parsed.reasoning,
  };
}

export interface JudgeHooks {
  onToken?: (chunk: string) => void;
}

export async function runJudge(
  apiKey: string,
  judgeModel: string,
  sandboxRoot: string,
  query: string,
  results: WorkerResult[],
  allResults: WorkerResult[],
  rounds: RoundSummary[],
  timeoutMs: number,
  hooks?: JudgeHooks,
): Promise<JudgeVerdict> {
  const sandbox = path.join(sandboxRoot, 'judge');
  mkdirSync(sandbox, { recursive: true });

  let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
  let output = '';
  let timedOut = false;

  try {
    agent = await Agent.create({
      apiKey,
      model: { id: judgeModel },
      local: { cwd: sandbox },
    });

    const run = await agent.send(buildJudgePrompt(query, results, allResults, rounds));
    const timer = setTimeout(() => {
      timedOut = true;
      if (run.supports('cancel')) void run.cancel().catch(() => {});
    }, timeoutMs);

    try {
      for await (const event of run.stream()) {
        if (event.type === 'assistant') {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              output += block.text;
              hooks?.onToken?.(block.text);
            }
          }
        }
      }
      const result = await run.wait();
      if (timedOut) throw new Error(`judge exceeded ${timeoutMs}ms`);
      if (result.status !== 'finished') {
        throw new Error(`judge run status: ${result.status}`);
      }
    } finally {
      clearTimeout(timer);
    }

    return parseVerdict(output);
  } catch (err) {
    const msg =
      err instanceof CursorAgentError
        ? `judge startup failed: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(msg);
  } finally {
    if (agent) {
      try {
        await agent[Symbol.asyncDispose]();
      } catch {
        /* non-fatal */
      }
    }
  }
}
