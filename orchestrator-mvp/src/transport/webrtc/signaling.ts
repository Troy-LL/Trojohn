import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import type { Message } from '../types.js';

export interface SignalingHub {
  port: number;
  publish(msg: Message): void;
  sendToNode(nodeId: string, msg: Message): void;
  subscribe(handler: (msg: Message) => void): () => void;
  getConnectedNodes(): string[];
  close(): void;
}

interface ClientMeta {
  nodeId: string;
  ws: WebSocket;
}

/** WebSocket signaling hub for hub-and-spoke mesh (WebRTC-compatible wire format). */
export function createSignalingHub(port: number): SignalingHub {
  const wss = new WebSocketServer({ port });
  const clients = new Map<string, ClientMeta>();
  const bus = new EventEmitter();

  wss.on('connection', (ws) => {
    let nodeId = '';

    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(String(data)) as
          | { type: 'register'; nodeId: string }
          | { type: 'message'; msg: Message };

        if (parsed.type === 'register') {
          nodeId = parsed.nodeId;
          clients.set(nodeId, { nodeId, ws });
          ws.send(JSON.stringify({ type: 'registered', nodeId }));
          return;
        }

        if (parsed.type === 'message' && parsed.msg) {
          bus.emit('message', parsed.msg);
          routeToClients(clients, parsed.msg);
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      if (nodeId) clients.delete(nodeId);
    });
  });

  return {
    port,
    publish(msg: Message) {
      bus.emit('message', msg);
      routeToClients(clients, msg);
    },
    sendToNode(nodeId: string, msg: Message) {
      const client = clients.get(nodeId);
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'message', msg }));
      }
    },
    subscribe(handler: (msg: Message) => void) {
      bus.on('message', handler);
      return () => bus.off('message', handler);
    },
    getConnectedNodes() {
      return [...clients.keys()];
    },
    close() {
      wss.close();
    },
  };
}

function routeToClients(clients: Map<string, ClientMeta>, msg: Message): void {
  const payload = JSON.stringify({ type: 'message', msg });
  for (const [id, client] of clients) {
    if (id === msg.sender) continue;
    if (msg.recipient !== 'broadcast' && msg.recipient !== id && msg.recipient !== 'orchestrator') {
      continue;
    }
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

export function connectPhoneAgent(
  url: string,
  nodeId: string,
  onMessage: (msg: Message) => void,
): { publish: (msg: Message) => void; close: () => void; ready: Promise<void> } {
  const ws = new WebSocket(url);
  const ready = new Promise<void>((resolve, reject) => {
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', nodeId }));
    });
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(String(data)) as { type: string; msg?: Message; nodeId?: string };
        if (parsed.type === 'registered') resolve();
        if (parsed.type === 'message' && parsed.msg) onMessage(parsed.msg);
      } catch {
        // ignore
      }
    });
    ws.on('error', reject);
  });

  return {
    ready,
    publish(msg: Message) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message', msg }));
      }
    },
    close() {
      ws.close();
    },
  };
}
