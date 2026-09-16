export class ForegroundError extends Error {}

export class ForegroundObservationError extends ForegroundError {
  constructor(reason: string) {
    super(`Foreground observation failed: ${reason}.`);
  }
}
