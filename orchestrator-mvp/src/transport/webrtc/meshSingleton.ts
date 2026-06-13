import type { SignalingHub } from './signaling.js';
import { HubMeshTransport } from './hubTransport.js';

let hub: SignalingHub | null = null;
let transport: HubMeshTransport | null = null;

export function initMeshHub(signalHub: SignalingHub): HubMeshTransport {
  hub = signalHub;
  transport = new HubMeshTransport(signalHub);
  return transport;
}

export function getMeshTransport(): HubMeshTransport {
  if (!transport) throw new Error('Mesh hub not initialized — start server with TRANSPORT=webrtc');
  return transport;
}

export function getMeshHub(): SignalingHub | null {
  return hub;
}

export { HubMeshTransport } from './hubTransport.js';
export { PhoneMeshTransport } from './hubTransport.js';
