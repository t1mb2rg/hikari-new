export class ContinuityError extends Error {}

export class NotInitializedError extends ContinuityError {
  constructor() {
    super('Hikari origin record does not exist.');
  }
}

export class InvalidOriginError extends ContinuityError {
  constructor(reason: string) {
    super(`Hikari origin record is invalid: ${reason}.`);
  }
}

export class UnsupportedVersionError extends ContinuityError {
  constructor(version: unknown) {
    super(`Hikari origin record version is not supported: ${String(version)}.`);
  }
}

export class AlreadyInitializedError extends ContinuityError {
  constructor(hikariId: string) {
    super(`Hikari is already initialized: ${hikariId}.`);
  }
}

export class AmbiguousStateError extends ContinuityError {
  constructor(reason: string) {
    super(`Hikari continuity state cannot be trusted: ${reason}.`);
  }
}
