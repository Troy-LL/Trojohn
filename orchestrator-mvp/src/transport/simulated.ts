import { EventEmitter } from 'node:events';
import type { Message, MessageType, Transport } from './types.js';

const DELIBERATION_TYPES = new Set<MessageType>(['proposal', 'critique', 'revision']);

export interface SimulatedTransportOptions {
  latencyMs: number;
  jitterMs: number;
  dropRate: number;
}

/**
 * Wraps an in-process bus with optional latency, jitter, and drops on
 * deliberation payloads only. Lifecycle/UI messages pass through immediately.
 */
export class SimulatedNetworkTransport implements Transport {
  private bus = new EventEmitter();
  private stats = { published: 0, delivered: 0, dropped: 0 };

  constructor(private readonly opts: SimulatedTransportOptions) {
    this.bus.setMaxListeners(100);
  }

  getStats(): { published: number; delivered: number; dropped: number } {
    return { ...this.stats };
  }

  publish(msg: Message): void {
    if (!DELIBERATION_TYPES.has(msg.type)) {
      this.bus.emit('message', msg);
      return;
    }

    this.stats.published++;

    if (Math.random() < this.opts.dropRate) {
      this.stats.dropped++;
      return;
    }

    const jitter = this.opts.jitterMs > 0 ? (Math.random() * 2 - 1) * this.opts.jitterMs : 0;
    const delay = Math.max(0, this.opts.latencyMs + jitter);

    setTimeout(() => {
      this.stats.delivered++;
      this.bus.emit('message', msg);
    }, delay);
  }

  subscribe(handler: (msg: Message) => void): () => void {
    this.bus.on('message', handler);
    return () => this.bus.off('message', handler);
  }
}
