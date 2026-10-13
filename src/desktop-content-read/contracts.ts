import { defineService } from '../runtime/contracts.js';
import type { ContentRead } from './types.js';

// This plugin's first Service, and the Contract Creation Gate is what moved rather than this module.
//
// `plugin.ts` argued that a Service here would be one published for nobody: the only thing that ever
// asked this capability a question was a client arriving through a pipe. That argument was a claim
// about the composition, and the composition changed. G-1's ruling put the read inside Language as
// *material* rather than as a model-callable capability, and that decision has a caller in it — the
// one `answerScreen` path, which needs the read as an argument to a model call and cannot get it
// through a pipe it is not on the far side of. So the gate is satisfied by a call that happens, in
// the sense `src/language/contracts.ts` uses the phrase: not "somebody might want this", but "here is
// the call site".
//
// ---------------------------------------------------------------------------------------------
// One method, no policy argument, and no baseline
// ---------------------------------------------------------------------------------------------
//
// `desktop-session-awareness` needs two contracts because it holds a baseline and its two questions
// differ in whether asking consumes that baseline. This plugin holds no such sequence. The samples it
// keeps are a window of recent observations rather than a comparison partner, a read neither advances
// nor is measured from anything, and the sample a read uses is chosen by `target.ts`'s attribution
// rule — which is this module's judgement about the world and not a caller's choice. So there is no
// second question to separate out, and no flag that would let a caller substitute its own rule. A
// caller that could name the window would be naming one Hikari never observed, which is the same
// reason `protocol.ts` has a request type with one word and no operand.
//
// ---------------------------------------------------------------------------------------------
// What it returns, and why not the lines the endpoint sends
// ---------------------------------------------------------------------------------------------
//
// The endpoint renders, because what crosses a pipe is text a CLI prints. A Service consumer is
// inside the process, and what it needs is the read rather than one particular transcription of it —
// so this returns `ContentRead` and rendering stays where it already lives, reachable by the same
// barrel `presentation.ts` is exported from. This is the shape `desktop-session-observe` already uses
// against `desktop-session-awareness.peek@1`: the owner returns the judgement, and the consumer
// renders it through the owner's own renderer.
//
// ---------------------------------------------------------------------------------------------
// What providing this does and does not say
// ---------------------------------------------------------------------------------------------
//
// It says the read can be asked for. It does not say who may ask. This is the distinction
// `src/language/contracts.ts` is built around — providing a contract states that a capability is
// expressible, never that a given speaker is entitled to it — and it matters here more than
// anywhere else in the composition, because the thing behind this contract is a human's screen.
//
// The entitlement is not in this contract and deliberately is not enforced here. It is the request
// word: `screen` is a fourth way of asking rather than a variant of the other three, it is the only
// way into `answerScreen`, and only the human at the CLI can send it. A plugin that requires this
// contract can read window content, and today the only plugin that does is Language — which is a
// fact about the composition rather than a check in this file, and is stated here so that a later
// reader adding a second `requires` can see what they are adding.

export interface DesktopContentReadService {
  /**
   * Reads the window Hikari most recently observed and can attribute to a human, now.
   *
   * The read happens here rather than at sample time: the sample bound to the observation, and the
   * walk against it happens when somebody asks. A read with no admissible sample rejects — the same
   * rejection the endpoint turns into `failed`, produced by the same function, so that the pipe and
   * the in-process caller cannot disagree about what "there is no window to read" looks like.
   *
   * This does not consume anything and does not change what a later read will see. Two reads in a row
   * before the next awareness cadence walk the same sample and differ only in the time they report.
   */
  read(): Promise<ContentRead>;
}

export const desktopContentReadService = defineService<DesktopContentReadService>(
  'desktop-content-read.read',
  1,
);
