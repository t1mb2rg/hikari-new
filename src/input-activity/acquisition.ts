import type { InputActivityObservation, InputActivitySource } from './types.js';

export interface InputActivityAcquisition {
  readonly observedAt: string;
  readonly lastInputTick: number;
}

export interface InputActivityAcquirer {
  acquire(): Promise<InputActivityAcquisition>;
  dispose(): Promise<void>;
}

const OBSERVATION_SOURCE: InputActivitySource = 'input-activity.windows';

export function toObservation(acquisition: InputActivityAcquisition): InputActivityObservation {
  return Object.freeze({
    observedAt: acquisition.observedAt,
    source: OBSERVATION_SOURCE,
    lastInputTick: acquisition.lastInputTick,
  });
}
