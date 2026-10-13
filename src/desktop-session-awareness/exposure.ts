// What this plugin offers an intelligence layer, and which of its two contracts the offer is a view of.
//
// The same shape and the same reasons as `work-focus/exposure.ts` — a capability is the view formed
// from a public Service (`core-architecture-v0.md` §5.3), so this is two strings and a pointer at a
// contract that already exists, exported by the owner of the semantics. Nothing is copied, nothing is
// registered, and `service` is the same frozen object `contracts.ts` exports, so the claim "this
// exposure is a view of that Service" is one a test can prove rather than one a reader must trust.
//
// It points at `peek` and not at `current`, and that choice is the whole content of this file. Both
// contracts answer the same question with the same comparison against the same baseline; they differ in
// whether the snapshot the answer was computed from becomes the next comparison partner. `current()` is
// the driver's question — holding it means holding the ability to move the timeline. `peek()` is the
// reader's question, and a look at the desktop must not become a step in the sequence of judgements
// about it: the next assessment, whoever makes it, has to be measured from the moment before somebody
// looked rather than from the look.
//
// That is a property of which contract is named here rather than a rule a caller is asked to keep, and
// it is the reason the two contracts were never merged into one method with a flag — see the argument in
// `contracts.ts`. A consumer cannot reach `current()` through this exposure, because this exposure does
// not name it, and the test that proves so is an identity assertion rather than a call count.
//
// The owner is this plugin and not `desktop-session-observe`. Observe owns the human-facing rendering of
// an assessment and holds no facts of its own — its whole setup is a lookup and an `await` — so an
// exposure exported from there would be a view of a view, and the description would belong to a plugin
// that does not know what a desktop session is. Rendering stays where it is; the semantics of reading
// the desktop live here.
//
// The description carries what the capability does *not* mean, and that is the load-bearing half. Every
// one of these inferences is available to a reader of the underlying facts and none of them is
// established by them: a foreground application is not a statement about what the person is doing with
// it, `stable` is not a statement that nothing happened, `changed` is not a statement about importance,
// and input activity is not a measurement of attention. A capability that let a model take those steps
// would be handing it conclusions this plugin never drew.
//
// The fifth sentence is a different kind of statement from the four beside it, and the difference is why
// it was the one missing. The other four refuse an *inference* from facts that are present. The fifth
// refuses a *reading* that was never taken: this offer carries window identity and this plugin's verdicts
// about it, and carries no body text, because reading a window's contents happens on another path and
// under another question entirely. Nothing in the four inferences implies it — a reader who has been told
// `changed` is not importance has still been told nothing about whether the window's contents arrived —
// and a model holding this reading while believing it has also seen the screen is wrong in a way no
// downstream sentence can correct. It is stated here because this description is the only place a model
// learns what the name it picked actually returns.
//
// Deliberately absent, for the reason `work-focus/exposure.ts` records at length: no input schema, no
// output schema, no authority or side-effect classification, no tags, categories, cost, hints, examples,
// aliases or discovery keywords. A read capability that takes no arguments needs none of them.

import type { ServiceContract } from '../runtime/contracts.js';

import {
  desktopSessionAwarenessPeekService,
  type DesktopSessionAwarenessPeekService,
} from './contracts.js';

/**
 * What an intelligence layer is offered, and what it is offered about.
 *
 * Three fields, and the third is what keeps the first two honest: a name and a description with nothing
 * underneath them would be a label a consumer could attach to whichever Service it preferred.
 */
export interface DesktopContextReadExposure {
  /**
   * The stable name a model selects this by. Agent-facing vocabulary, deliberately not a contract id.
   *
   * It is also the string that goes on the wire as `tools[*].function.name`, and that wire constrains it
   * rather than this repo: OpenAI-compatible function calling requires `^[a-zA-Z0-9_-]+$`. A contract id
   * such as `desktop-session-awareness.peek@1` is legal here and a dotted `desktop_context.read` is not —
   * the provider answers a malformed name with a 400 on the request, which reaches the caller as a model
   * that never spoke rather than as a capability a model declined to pick. The two vocabularies are
   * separate on purpose: this one is chosen to survive the wire, the contract id is chosen to be a
   * stable identity.
   */
  readonly name: string;
  /** What the capability covers and, just as load-bearingly, what it does not. */
  readonly description: string;
  /** The public Service this is a view of. `peek`, so that reading cannot advance the timeline. */
  readonly service: ServiceContract<DesktopSessionAwarenessPeekService>;
}

/**
 * The desktop session, as an intelligence layer may ask for it.
 *
 * The description states the non-consumption as part of what the capability *is*, because it is: the
 * assessment a caller gets through this name is the one that leaves the judgement timeline exactly where
 * it found it. Both halves of that sentence are asserted — one by identity against the contract, one by
 * reading twice through a real awareness plugin and watching what the next `current()` reports.
 */
export const desktopContextReadExposure: DesktopContextReadExposure = Object.freeze({
  name: 'desktop_context_read',
  description:
    '读取 Hikari 当前的桌面会话观察与 awareness assessment，这次读取不会推进 desktop awareness 的时间线。返回的是 Hikari 已经建立的事实与判词本身，不含引申：前台是某个应用不等于用户正在做与之相关的事，stable 不等于什么都没发生，changed 不等于重要，输入活动不等于用户的专注程度。它读的是窗口的身份（进程名、窗口标题）与 Hikari 对它的判词，不是窗口里的内容：这一项不含窗口正文，读到它也不等于 Hikari 读过了窗口里的内容。',
  service: desktopSessionAwarenessPeekService,
});
