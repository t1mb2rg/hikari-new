// One question in, one of three outcomes out, and every decision this slice makes in between.
//
// This file exists because of where it is tested. The behaviours that matter here — the model's word is
// looked up rather than trusted, a refusal is not a failure, a follow-up sees the last accepted turn and
// a failed model call does not become one — are the whole of what this slice claims, and a version of
// them that lived inside a plugin's `setup` could only be reached through a named pipe. CI runs on
// Linux, where there are no named pipes and every such test is skipped: `desktop-session-observe` was
// bitten by exactly this and says so in its own barrel — "a rule pinned only by tests that need a named
// pipe is a rule CI does not check at all". So the pipeline is a plain function of four injected
// dependencies, and a test drives it by choosing what the model says, what the focus holds, what the
// peek returns and what time it is.
//
// The dependencies are seams, not configuration: none of them is settable from argv, none reaches the
// plugin's config, and the plugin wires all four to the real things in one place. `github-ci/github.ts`
// uses the same word for the same reason.
//
// What this file is not: it does not talk to a model, hold an endpoint, know about pipes, or hold a
// clock. It takes a sentence and returns a verdict about it, and the state it keeps between calls is
// one dialogue turn.

import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';

import { advanceDialogue, usableDialogueTurn, type DialogueTurn } from './dialogue.js';
import {
  emptyQuestionLines,
  groundingFailureLines,
  longQuestionLines,
  modelFailureLines,
  renderAnswer,
  unclassifiedLines,
  type GroundedAnswer,
} from './express.js';
import type { LanguageTopic } from './topics.js';
import { MAX_LANGUAGE_TEXT_LENGTH, type LanguageReply } from './types.js';
import { buildUnderstandingPrompt, readUnderstanding, type UnderstandingPrompt } from './understanding.js';

/**
 * Everything this pipeline needs from outside itself, and the whole of it.
 *
 * `classify` answers with the model's text and no interpretation: turning that text into a topic is
 * `readUnderstanding`'s job, and keeping the two apart is what makes "the model's output must survive a
 * closed-set lookup" visible here rather than assumed.
 *
 * `now` is injected rather than read, which is the one dependency that exists purely so a test can move
 * time. Expiry is a claim about a clock, and a claim about a clock that can only be tested by waiting
 * five minutes is a claim nobody tests.
 */
export interface LanguageDependencies {
  readonly classify: (prompt: UnderstandingPrompt) => Promise<string>;
  readonly readFocus: () => Promise<readonly string[]>;
  readonly peek: () => Promise<DesktopSessionAwarenessAssessment>;
  readonly now: () => string;
}

export interface Answerer {
  answer(text: string): Promise<LanguageReply>;
}

/**
 * The pipeline, with the dialogue turn in its closure.
 *
 * That closure is the state, and it is the whole of it: one answerer is one activation's short-term
 * context, a new answerer has never been asked anything, and there is nowhere else for the turn to be —
 * no file, no store, no service. "A restart forgets" is therefore the constructor's behaviour rather
 * than a cleanup path, which is also why it cannot be forgotten by a later edit.
 */
export function createAnswerer(dependencies: LanguageDependencies): Answerer {
  let turn: DialogueTurn | null = null;

  return {
    async answer(text: string): Promise<LanguageReply> {
      const now = dependencies.now();

      // Refusals, not failures. Each of these is a request this build will not answer, and the request
      // itself said exactly what it meant. The length bound is enforced here and not only in the client,
      // because the client is not the only thing that can speak this protocol.
      if (text.trim() === '') return { outcome: 'refused', lines: emptyQuestionLines() };
      if (text.length > MAX_LANGUAGE_TEXT_LENGTH) {
        return { outcome: 'refused', lines: longQuestionLines(MAX_LANGUAGE_TEXT_LENGTH) };
      }

      // Resolved before the model is asked and used after the facts are read, so that what this answer
      // was understood against is what was usable when the question arrived — not what happens to be
      // there by the time an acquisition finishes.
      const contextUsed = usableDialogueTurn(turn, now);

      let raw: string;
      try {
        raw = await dependencies.classify(buildUnderstandingPrompt(text, contextUsed));
      } catch (error) {
        // `failed`, and never `refused`. A model that is down has said nothing about the question, and
        // reporting it as "I did not understand you" would blame the human for a failure on this side.
        // The two are separate outcomes because the repairs are different: ask something else, versus
        // come back.
        return { outcome: 'failed', lines: modelFailureLines(describe(error)) };
      }

      // The model's string dies on this line. It is looked up in a closed set and only a member of that
      // set survives — no part of `raw` is kept, quoted, logged or rendered, and the refusal below says
      // the same thing whatever the model wrote. This is the whole of "the model cannot author
      // reality": not a rule about what the model may say, but a place its words have to become one of
      // four known values before anything else can happen.
      const topic = readUnderstanding(raw);
      if (topic === undefined) return { outcome: 'refused', lines: unclassifiedLines() };

      let grounded: GroundedAnswer;
      try {
        grounded = await ground(topic, dependencies);
      } catch (error) {
        // A dependency that rejected means the facts were not read. Answering out of whatever arrived
        // before the rejection would be this pipeline forming a sentence about a reading that never
        // completed — the one thing a surface whose job is to be checkable must not do.
        return { outcome: 'failed', lines: groundingFailureLines(describe(error)) };
      }

      // Recorded only now, after a question was actually answered. A refusal understood nothing and a
      // failure never reached the model; letting either become the new referent would make the next
      // "刚才那个" point at a question Hikari never answered.
      turn = advanceDialogue(topic, now);
      return { outcome: 'answered', lines: renderAnswer(grounded, contextUsed) };
    },
  };
}

// Which contracts are read for which topic, and nothing beyond that. `work-focus` reads no desktop
// source at all, so the most common question costs no acquisition of anything — a property worth
// keeping visible, because the obvious implementation reads both unconditionally and nothing would
// notice until someone wondered why asking about the focus launched a subprocess.
//
// The focus read is the contract's own `current()` rather than anything captured earlier: it returns the
// set the plugin is holding at call time, so a designation declared a moment ago is in the answer.
async function ground(topic: LanguageTopic, dependencies: LanguageDependencies): Promise<GroundedAnswer> {
  if (topic === 'work-focus') {
    return { topic, designations: await dependencies.readFocus() };
  }

  const assessment = await dependencies.peek();
  if (topic === 'current-context') {
    return { topic, designations: await dependencies.readFocus(), assessment };
  }
  // Both remaining topics are answered by the same assessment and are told apart by the tag, which is
  // the whole of the difference between them: `desktop-state` reports what is there and
  // `desktop-change` reports it against the previous snapshot, and that comparison is already inside
  // the assessment. Writing the two cases out separately would say there was a decision here.
  return { topic, assessment };
}

// Only the message. An error's stack, its `cause` chain and whatever a custom error carries are not this
// surface's to print, and the one thing a human needs is the sentence that says what failed.
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
