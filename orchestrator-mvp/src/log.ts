import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { OrchestratorResponse } from './types.js';
import type { Message } from './transport/types.js';

export class SessionLogger {
  private filePath: string;

  constructor(logDir: string, sessionId: string) {
    mkdirSync(logDir, { recursive: true });
    this.filePath = path.join(logDir, `${sessionId}.jsonl`);
  }

  logEvent(msg: Message): void {
    appendFileSync(this.filePath, JSON.stringify({ kind: 'event', ...msg }) + '\n');
  }

  logResult(result: OrchestratorResponse): void {
    appendFileSync(this.filePath, JSON.stringify({ kind: 'result', ...result }) + '\n');
  }
}
