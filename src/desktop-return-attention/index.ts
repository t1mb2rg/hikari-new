export { desktopReturnAttentionPlugin } from './plugin.js';
export type { DesktopReturnAttentionPluginConfig } from './plugin.js';
export {
  INITIAL_DESKTOP_RETURN_WATCH,
  formOccurrence,
  renderOccurrence,
  stepReturn,
} from './judgement.js';
export type { DesktopReturnStep, DesktopReturnWatch } from './judgement.js';
export type { DesktopReturnOccurrence } from './types.js';

// `renderOccurrence` is exported for the reason `repository-ci-attention/index.ts` gives for exporting
// its own: `language` imports an owner's fact type and an owner's pure renderer, never the ability to
// judge anything about them. `stepReturn` and `formOccurrence` are exported for the reason that file
// gives for `detectNewFailure` — CI runs on `ubuntu-latest`, where nothing that needs a Windows child
// process is reachable, so a rule pinned only by a test that needs one is a rule CI never checks.
