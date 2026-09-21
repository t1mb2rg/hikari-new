/** The only version this build speaks. A mismatch is refused, never guessed at. */
export const WORK_FOCUS_PROTOCOL_VERSION = 1;

/**
 * The four words. Unlike the Resident's control vocabulary, these are this module's own domain
 * vocabulary — which is the whole reason they are not words in that vocabulary (see `index.ts`).
 */
export type WorkFocusWord = 'declare' | 'replace' | 'clear' | 'status';

/**
 * A request carries a payload, and that is the essential difference from a control request: what a
 * human declares cannot be enumerated in advance, so it travels with the word.
 */
export type WorkFocusRequest =
  | { readonly word: 'declare'; readonly designation: string }
  | { readonly word: 'replace'; readonly designations: readonly string[] }
  | { readonly word: 'clear' }
  | { readonly word: 'status' };

export interface WorkFocusReply {
  readonly outcome: 'ok' | 'failed';
  readonly lines: readonly string[];
}

/** The answer to a work focus request, in the same four shapes the control channel uses. */
export type WorkFocusOutcome =
  | { readonly kind: 'answered'; readonly outcome: 'ok' | 'failed'; readonly lines: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

// Bounds on the decoded text, not on wire bytes.
//
// The request bound is deliberately far larger than the control channel's 1024. That bound exists
// because the control vocabulary is two words about forty characters long and a payload would be a
// schema; here a request carries text a human wrote, and this module has no business deciding how
// long a name for their own work may be. The bound stays because a bound has to exist — whoever is
// on the other end of the pipe should not get to choose how much this process buffers — but it is
// set where argv itself has already stopped being the limit.
export const MAX_WORK_FOCUS_REQUEST_LINE = 64 * 1024;

// Not the same number as the request bound, and the difference is not cosmetic. Every reply to a
// write echoes back what was written, so a reply is always at least as large as the request that
// produced it, plus the reply envelope and the header line. A client that bounded the answer at the
// bound it used for the question would have exactly one window — a request sitting right at the
// limit — in which a write that succeeded was reported to the human as a failure. Slack is the
// honest shape of "at least as large": it does not pretend to know the overhead to the byte.
export const MAX_WORK_FOCUS_REPLY_LINE = MAX_WORK_FOCUS_REQUEST_LINE + 4096;
