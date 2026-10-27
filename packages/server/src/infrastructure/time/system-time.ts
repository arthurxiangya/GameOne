import { performance } from 'node:perf_hooks';
import type { SystemTime } from '../../application/ports';

export const systemTime: SystemTime = {
  monotonic: () => performance.now() / 1000,
  iso: () => new Date().toISOString(),
};
