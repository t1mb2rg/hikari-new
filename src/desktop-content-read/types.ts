// The wire vocabulary, the result shape, the bounds, and the one internal value that never crosses
// the pipe.
//
// The result shape is §3.6 of the D0 Content Reader Boundary Review, carried here without addition:
// five kinds, three channels, a region grouping, and a bounds record. Everything in it is a claim the
// ground truth measured rather than a shape chosen for convenience, and each of the four decisions
// §3.6 names is preserved exactly:
//
//   `viewportRelation` is four-valued, and `unknown` is one of the four. A binary would manufacture
//   a conclusion about an element whose geometry could not be read, and §3.6 records that measured
//   boundary rows are precisely where that happens.
//
//   `notVisibleBecause` is a separate field, because "cannot be seen" (geometry) and "why it cannot
//   be seen" (off the edge, or clipped by a container) are two questions. Folding them into one enum
//   would make `offscreen` and `clipped` mutually exclusive, and an element is regularly both.
//
//   `channel` is exposed and is *not* a content judgement. The ground truth measured that on WPF the
//   `Name` property is itself a body-text channel — 38 visible lines, one TextPattern — so "has a
//   TextPattern" cannot be used to decide that a node is content, and a node whose text came from
//   `Name` is never relabelled as text.
//
//   The window identity travels with every kind, including the three that carry no content. §3.4's
//   third guard: the result says which window it read, so attribution can be checked from outside
//   rather than taken on this module's word.
//
// One field is added to `WindowIdentity` relative to §3.6 — `observedAt` — and it is the whole of
// what Check A of the implementation mandate requires to be preserved. The target is not chosen at
// read time; see `target.ts` for what it is chosen from and why.

export const DESKTOP_CONTENT_READ_PROTOCOL_VERSION = 1;

/** The one question this endpoint answers. There is no second word and no operand. */
export type DesktopContentReadWord = 'status';

// A request is one word inside a JSON envelope, so the bound is generous by a wide margin. It is
// here for the same reason every bound in this repository is: a reader that accumulates without one
// is a reader a caller can exhaust.
export const MAX_CONTENT_READ_REQUEST_LINE = 1024;

// The three bounds of §3.5, and the numbers are first-slice values rather than measured optima. They
// exist so that a walk cannot run unbounded; each is reported in the result, and reaching one is
// reported as `truncatedBy` rather than absorbed.
//
//   depth    the deepest element the walk will descend to. Reaching it *stops the walk* rather than
//            pruning that branch: `walk.ps1`'s `Stop-With` sets a flag every sibling loop checks, so a
//            window whose first branch runs deep loses whatever the walk had not reached yet,
//            including elements shallower than the bound. That is the accepted first-slice semantics
//            rather than an oversight — global truncation is one line and one flag, per-branch pruning
//            is a stack discipline — and it is pinned by a test against a synthetic window so the
//            number and the behaviour cannot drift apart. `presentation.ts` says the same thing to the
//            human, in the sentence it prints for `truncatedBy === 'depth'`.
//   nodes    elements *visited*. This bounds the walk itself, which is why it counts visits and not
//            matches: a tree of a million unlabelled containers produces no content and would
//            otherwise run until the process timeout, turning an ordinary empty answer into a
//            refusal.
//   chars    characters of content kept.
export const READ_MAX_DEPTH = 32;
export const READ_MAX_NODES = 2000;
export const READ_MAX_CHARS = 40_000;

// The reply carries a rendered read, and this is a ceiling on the framing rather than a second
// content bound: the content bound is `READ_MAX_CHARS` and it is the one the result reports.
//
// It is derived rather than chosen, because the obvious way to choose it is wrong by a factor of
// seven. "A rendered read cannot exceed the character bound plus the labelling around it" is a
// sentence this file used to carry, and it is false: rendering multiplies. `presentation.ts`
// escapes every line through `oneLine`, where one escapable character becomes the six characters
// `\u009b`, and `JSON.stringify` then escapes that backslash into seven. A window whose body is
// nothing but line separators therefore arrives at seven times its source length — and a legitimate
// read at the char bound was measured at 316,610 characters against the 262,144 this constant used
// to be. What a human saw was `unavailable`, 无法访问 Hikari 桌面正文读取入口: a read that had
// completed, reported as an entry point that could not be reached.
//
// The three terms, all ceilings rather than estimates:
//
//   READ_MAX_CHARS × 7   the worst escape expansion, measured at 6 in `oneLine` and 7 through JSON
//   65536                the per-node labels, `    [name d32] `, and the region framing: 2000 nodes
//                        at 15 characters is 30,000, and the rest is the header and the bounds block
//   1                    the newline that joins the lines
//
// Written as an expression so it cannot drift out of step with `READ_MAX_CHARS`, and pinned by a
// test that renders the worst case rather than trusting this arithmetic — this arithmetic is exactly
// the kind that was wrong the first time.
export const MAX_CONTENT_READ_REPLY_LINE = READ_MAX_CHARS * 7 + 64 * 1024 + 1;

/** Which of the three bounds stopped the walk. `null` means none did. */
export type ContentReadTruncatedBy = 'depth' | 'nodes' | 'chars';

/**
 * Where a node's text was read from, and nothing more.
 *
 * The three are the three UIA channels the ground truth measured. A consumer may use this to tell
 * where a string came from. It may not use it to decide that a string is content, that a string is
 * the user's intent, or that a node without one channel is not content — the ground truth measured
 * `Name` carrying body text on WPF and carrying accessibility labels on the same window, with no
 * property distinguishing the two.
 */
export type ContentChannel = 'name' | 'text' | 'value';

/** An element's geometric relation to the frame it is judged against. `unknown` is a real answer. */
export type ViewportRelation = 'inside' | 'outside' | 'partial' | 'unknown';

/** Why an element cannot be seen, when it cannot. Never a substitute for `viewportRelation`. */
export type NotVisibleBecause = 'offscreen' | 'clipped-by-ancestor';

export interface ContentNode {
  /** Body text, exactly as UIA returned it. Never substituted from another channel. */
  readonly text: string;
  readonly channel: ContentChannel;
  /** Distance from the window's root element. Reported so a consumer can see the walk's shape. */
  readonly depth: number;
}

/**
 * Content that shares one frame and one verdict about that frame.
 *
 * Grouping is by (frame, relation, reason) rather than by frame alone, because the two fields below
 * describe the *nodes*, and nodes under one scrolling container do not share a verdict — that is the
 * whole of what the ground truth measured. `id` names the frame, which is the nearest ancestor whose
 * `ScrollPattern` is available, or the window's client area when no such ancestor was present in the
 * walk; it is therefore not unique across regions, and `(id, viewportRelation, notVisibleBecause)` is
 * what distinguishes one region from another.
 */
export interface Region {
  readonly id: string;
  readonly viewportRelation: ViewportRelation;
  readonly notVisibleBecause: NotVisibleBecause | null;
  readonly nodes: readonly ContentNode[];
}

export interface ContentReadBounds {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxChars: number;
  readonly truncatedBy: ContentReadTruncatedBy | null;
  /** Elements visited. Reported beside `matched` because a targeted read once dropped 32% of the
   *  body silently, and a match count alone cannot show that. */
  readonly scanned: number;
  /** Elements that contributed at least one node. */
  readonly matched: number;
  readonly textChars: number;
}

/** The probe that produced a window identity. Named, because a result must say where it came from. */
export type ContentReadWindowSource = 'desktop-content-read.windows-probe';

/**
 * Which window a read is about, and when Hikari saw that window in front.
 *
 * `observedAt` is the observation time of the sample and not the time of the read. Those differ by
 * design (see `target.ts`), and collapsing them would hide the one fact a consumer needs in order to
 * weigh the attribution.
 */
export interface WindowIdentity {
  /** Hexadecimal, as Windows spells it. Kept as a string so the wire carries the digits unchanged. */
  readonly handle: string;
  readonly title: string | null;
  readonly processName: string | null;
  readonly observedAt: string;
  readonly source: ContentReadWindowSource;
}

/**
 * The five kinds, and the rule that separates them.
 *
 * `refused` and `unreadable` are different answers and are never merged: the first is a window that
 * did not answer within the bound, the second is a window this process could not address at all.
 * `empty` and `truncated` are likewise never the same shape — an empty read is a walk that finished
 * and found nothing, and a truncated one is a walk that was stopped and may well have found more.
 *
 * There is deliberately no sixth kind for "Hikari has no window it can attribute to the human". That
 * case has no window identity to carry, and it is reported one layer out as the endpoint's `failed`
 * outcome, which is the vocabulary this repository already has for "the read could not be produced".
 */
export type ContentRead =
  | {
      readonly kind: 'read';
      readonly window: WindowIdentity;
      readonly regions: readonly Region[];
      readonly bounds: ContentReadBounds;
      /** When the walk ran, as opposed to when the window was observed. */
      readonly readAt: string;
    }
  | {
      readonly kind: 'empty';
      readonly window: WindowIdentity;
      readonly bounds: ContentReadBounds;
      readonly note: string;
    }
  | {
      readonly kind: 'truncated';
      readonly window: WindowIdentity;
      readonly regions: readonly Region[];
      readonly bounds: ContentReadBounds;
    }
  | { readonly kind: 'refused'; readonly window: WindowIdentity; readonly note: string }
  | { readonly kind: 'unreadable'; readonly window: WindowIdentity; readonly note: string };

/**
 * The three things asking can produce, matching every other endpoint in this repository's client.
 *
 * Three rather than four, and the missing one is the point: `unconfigured` means "a resident is
 * running whose composition has no such capability", which is sayable for a chain that is loaded only
 * when an operator asks for it. This plugin is a member of the base composition, so a resident either
 * has it or is not running, and there is no third thing for the control channel to tell apart.
 *
 * `answered` is not the same as `ok`. The reply's own `outcome` can be `failed` while the question was
 * answered — a window that has closed, a read that could not be attributed — and that distinction is
 * carried by `reply`, not flattened here. See `presentation.ts` for which failures are values and
 * which are rejections.
 */
export type DesktopContentReadOutcome =
  | { readonly kind: 'answered'; readonly reply: DesktopContentReadReply }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable'; readonly detail: string };

export interface DesktopContentReadRequest {
  readonly word: DesktopContentReadWord;
}

export interface DesktopContentReadReply {
  readonly outcome: 'ok' | 'failed';
  readonly lines: readonly string[];
}
