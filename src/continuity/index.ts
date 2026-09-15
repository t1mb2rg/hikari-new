export { continuityService } from './contracts.js';
export type { ContinuityService } from './contracts.js';
export { initializeHikari } from './initialize.js';
export type { InitializeHikariOptions } from './initialize.js';
export { restoreHikari } from './restore.js';
export type { RestoreHikariOptions } from './restore.js';
export { continuityPlugin } from './plugin.js';
export type { ContinuityPluginConfig } from './plugin.js';
export { resolveOriginPath } from './storage.js';
export type { HikariIdentity, OriginRecordV1 } from './types.js';
export {
  AlreadyInitializedError,
  AmbiguousStateError,
  ContinuityError,
  InvalidOriginError,
  NotInitializedError,
  UnsupportedVersionError,
} from './errors.js';
