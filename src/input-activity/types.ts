export type InputActivitySource = 'input-activity.windows';

export interface InputActivityObservation {
  readonly observedAt: string;
  readonly source: InputActivitySource;
  readonly lastInputTick: number;
  /**
   * The same counter as `lastInputTick`, read in the same snapshot: the platform's millisecond counter
   * as it stood when this observation was taken.
   *
   * Both ticks are one clock in one domain, so the difference between them is a duration and
   * subtracting one from the other is legal. `observedAt` is a different clock entirely — a UTC wall
   * timestamp — and is never subtracted from either tick.
   */
  readonly observedTick: number;
}
