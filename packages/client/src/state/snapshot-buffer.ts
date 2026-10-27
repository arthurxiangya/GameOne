import { lerp, lerpAngle } from '@lanternwood/shared';

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PoseSample extends Pose {
  /** Server time of the snapshot this pose came from, in seconds. */
  readonly t: number;
}

const CAPACITY = 32;
/** How far past the newest sample we are willing to extrapolate before freezing. */
const MAX_EXTRAPOLATION = 0.1;

/**
 * Time-ordered poses of one remote entity. Rendering samples it slightly in the past so
 * there are almost always two snapshots to interpolate between, which hides jitter.
 */
export class SnapshotBuffer {
  private readonly samples: PoseSample[] = [];

  push(sample: PoseSample): void {
    const last = this.samples[this.samples.length - 1];
    if (last && sample.t <= last.t) return;
    this.samples.push(sample);
    if (this.samples.length > CAPACITY) this.samples.shift();
  }

  get latest(): PoseSample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Writes the interpolated pose at server time `t` into `out`. Returns false if empty. */
  sample(t: number, out: Pose): boolean {
    const n = this.samples.length;
    if (n === 0) return false;
    const first = this.samples[0]!;
    if (n === 1 || t <= first.t) {
      copyPose(first, out);
      return true;
    }
    for (let i = n - 2; i >= 0; i--) {
      const a = this.samples[i]!;
      if (a.t > t) continue;
      const b = this.samples[i + 1]!;
      const span = b.t - a.t;
      const alpha = span > 0 ? Math.min(1 + MAX_EXTRAPOLATION / span, (t - a.t) / span) : 1;
      out.x = lerp(a.x, b.x, alpha);
      out.y = lerp(a.y, b.y, alpha);
      out.z = lerp(a.z, b.z, alpha);
      out.yaw = lerpAngle(a.yaw, b.yaw, Math.min(1, alpha));
      return true;
    }
    copyPose(this.samples[n - 1]!, out);
    return true;
  }
}

const copyPose = (from: Pose, to: Pose): void => {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.yaw = from.yaw;
};
