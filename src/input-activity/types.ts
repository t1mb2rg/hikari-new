export type InputActivitySource = 'input-activity.windows';

export interface InputActivityObservation {
  readonly observedAt: string;
  readonly source: InputActivitySource;
  readonly lastInputTick: number;
}
