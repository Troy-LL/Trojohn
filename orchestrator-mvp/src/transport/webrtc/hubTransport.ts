import type { SignalingHub } from './signaling.js';
import type { Message, Transport } from '../types.js';

/** Hub-side transport: merges signaling hub with local Transport interface. */
export class HubMeshTransport implements Transport {
  private handlers = new Set<(msg: Message) => void>();
  private unsubHub: () => void;

  constructor(private readonly hub: SignalingHub) {
    this.unsubHub = hub.subscribe((msg) => {
      for (const h of this.handlers) h(msg);
    });
  }

  publish(msg: Message): void {
    this.hub.publish({ ...msg, timestamp: msg.timestamp ?? Date.now() });
  }

  subscribe(handler: (msg: Message) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getConnectedNodes(): string[] {
    return this.hub.getConnectedNodes();
  }

  dispose(): void {
    this.unsubHub();
    this.handlers.clear();
  }
}

/** Phone-side transport over a single signaling connection. */
export class PhoneMeshTransport implements Transport {
  private handlers = new Set<(msg: Message) => void>();

  constructor(
    private readonly nodeId: string,
    private readonly publishFn: (msg: Message) => void,
    inboundHandler: (handler: (msg: Message) => void) => void,
  ) {
    inboundHandler((msg) => {
      if (msg.recipient !== 'broadcast' && msg.recipient !== this.nodeId && msg.recipient !== 'orchestrator') {
        return;
      }
      for (const h of this.handlers) h(msg);
    });
  }

  publish(msg: Message): void {
    this.publishFn({ ...msg, sender: msg.sender || this.nodeId, timestamp: Date.now() });
  }

  subscribe(handler: (msg: Message) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
