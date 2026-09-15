export class ChronicleError extends Error {}

export class ChronicleNotInitializedError extends ChronicleError {
  constructor() {
    super('Chronicle store does not exist.');
  }
}

export class ChronicleAlreadyInitializedError extends ChronicleError {
  constructor(owner: string) {
    super(`Chronicle is already initialized for ${owner}.`);
  }
}

export class ChronicleAmbiguousStateError extends ChronicleError {
  constructor(reason: string) {
    super(`Chronicle state cannot be trusted: ${reason}.`);
  }
}

export class InvalidChronicleStoreError extends ChronicleError {
  constructor(reason: string) {
    super(`Chronicle store is invalid: ${reason}.`);
  }
}

export class UnsupportedChronicleVersionError extends ChronicleError {
  constructor(version: unknown) {
    super(`Chronicle store version is not supported: ${String(version)}.`);
  }
}

export class ChronicleOwnerMismatchError extends ChronicleError {
  constructor(expected: string, actual: string) {
    super(`Chronicle store belongs to ${actual}, not to ${expected}.`);
  }
}

export class ChroniclePersistenceError extends ChronicleError {
  constructor(reason: string) {
    super(`Chronicle fact was not confirmed as persisted: ${reason}.`);
  }
}

export class InvalidFactError extends ChronicleError {
  constructor(reason: string) {
    super(`Fact is invalid: ${reason}.`);
  }
}
