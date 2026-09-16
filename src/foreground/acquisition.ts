import type { ForegroundObservation, ForegroundSource, ForegroundTarget } from './types.js';

export interface ForegroundAcquisition {
  readonly observedAt: string;
  readonly target: ForegroundTarget;
}

export interface ForegroundAcquirer {
  acquire(): Promise<ForegroundAcquisition>;
  dispose(): Promise<void>;
}

const OBSERVATION_SOURCE: ForegroundSource = 'foreground.windows';

export function toObservation(acquisition: ForegroundAcquisition): ForegroundObservation {
  return Object.freeze({
    observedAt: acquisition.observedAt,
    source: OBSERVATION_SOURCE,
    foreground: Object.freeze(acquisition.target),
  });
}
