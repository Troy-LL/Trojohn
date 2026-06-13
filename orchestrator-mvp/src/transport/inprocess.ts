import { EventEmitter } from 'node:events';
import type { Message, Transport } from './types.js';

export class InProcessTransport implements Transport {
  private bus = new EventEmitter();

  constructor() {
    // One UI stream + logger + orchestrator can all listen at once.
    this.bus.setMaxListeners(100);
  }

  publish(msg: Message): void {
    this.bus.emit('message', msg);
  }

  subscribe(handler: (msg: Message) => void): () => void {
    this.bus.on('message', handler);
    return () => this.bus.off('message', handler);
  }
}
