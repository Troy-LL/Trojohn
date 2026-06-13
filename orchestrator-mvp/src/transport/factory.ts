import type { AppConfig } from '../config.js';
import { InProcessTransport } from './inprocess.js';
import { SimulatedNetworkTransport } from './simulated.js';
import { getMeshTransport, initMeshHub } from './webrtc/meshSingleton.js';
import { createSignalingHub } from './webrtc/signaling.js';
import type { Transport } from './types.js';

let hubInitialized = false;

export function createTransport(cfg: AppConfig): Transport {
  if (cfg.transport === 'webrtc') {
    if (!hubInitialized) {
      initMeshHub(createSignalingHub(cfg.signalPort));
      hubInitialized = true;
      console.log(`Mesh signaling hub ws://localhost:${cfg.signalPort}`);
    }
    return getMeshTransport();
  }
  if (cfg.transport === 'simulated') {
    return new SimulatedNetworkTransport({
      latencyMs: cfg.simLatencyMs,
      jitterMs: cfg.simJitterMs,
      dropRate: cfg.simDropRate,
    });
  }
  return new InProcessTransport();
}

/** Called from server startup to ensure hub exists before orchestrator. */
export function ensureMeshHub(cfg: AppConfig): void {
  if (cfg.transport === 'webrtc' && !hubInitialized) {
    initMeshHub(createSignalingHub(cfg.signalPort));
    hubInitialized = true;
    console.log(`Mesh signaling hub ws://localhost:${cfg.signalPort}`);
  }
}

export { getMeshHub } from './webrtc/meshSingleton.js';
