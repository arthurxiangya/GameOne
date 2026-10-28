import type { SystemTime } from '@lanternwood/server/embedded';

export const browserTime: SystemTime = {
  monotonic: () => performance.now() / 1000,
  iso: () => new Date().toISOString(),
};
