export type ForegroundSource = 'foreground.windows';

export interface ForegroundTargetAbsent {
  readonly kind: 'absent';
}

export interface ForegroundTargetPresent {
  readonly kind: 'present';
  readonly title?: string | null;
  readonly processName?: string;
}

export type ForegroundTarget = ForegroundTargetAbsent | ForegroundTargetPresent;

export interface ForegroundObservation {
  readonly observedAt: string;
  readonly source: ForegroundSource;
  readonly foreground: ForegroundTarget;
}
