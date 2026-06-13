import type { AppConfig } from '../config.js';
import { InProcessTransport } from './inprocess.js';
import { SimulatedNetworkTransport } from './simulated.js';
import type { Transport } from './types.js';

export function createTransport(cfg: AppConfig): Transport {
  if (cfg.transport === 'simulated') {
    return new SimulatedNetworkTransport({
      latencyMs: cfg.simLatencyMs,
      jitterMs: cfg.simJitterMs,
      dropRate: cfg.simDropRate,
    });
  }
  return new InProcessTransport();
}
