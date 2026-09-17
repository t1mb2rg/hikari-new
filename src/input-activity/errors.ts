export class InputActivityError extends Error {}

export class InputActivityObservationError extends InputActivityError {
  constructor(reason: string) {
    super(`Input activity observation failed: ${reason}.`);
  }
}
