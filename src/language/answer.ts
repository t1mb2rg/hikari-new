// The loop: a human's sentence in, either a conversation or a set of readings out.
//
// This is the whole of the autonomy this plugin has, and it is worth stating exactly how much that is.
// The model decides **what to read next**. It does not decide what the readings mean, whether they are
// good news, what the human is probably doing, or how to say any of it — every line a human sees in a
// grounded answer comes from an owner's renderer, and the model's prose is discarded the moment a
// reading exists. `core-architecture-v0.md` allows a conventional agent loop *inside* an autonomous
// plugin as long as it does not stand for Hikari, and the shape of this one is what keeps that boundary
// from being a promise: the loop's only move is "read a thing I have not read", and its only other
// outcome is "stop".
//
// ## The two states, and the one-way door between them
//
// An interaction starts open. The model may talk, or it may read, and both are complete answers: talk
// is `chatted`, a reading is `answered`. The moment one read succeeds, that door closes for the rest of
// the interaction and does not reopen. From then on the only things the model can do are call another
// capability it has not called, or stop — and if it does anything else, whatever it wrote is thrown
// away and the interaction ends on the readings it already has.
//
// That is not a safety check bolted onto the end. It is what stops the surface from drifting back into
// the thing two slices were spent removing: a model that has seen a reading and is allowed to comment
// on it is a model forming a judgement about the desktop from a foreground process name, which is
// exactly the inference `desktop-context.read`'s own description says Hikari never drew. A grounding
// path where the model's words reach the human would have to answer, per sentence, whether the words
// were a reading or a claim about one. Keeping the door shut means there is no such sentence to judge.
//
// The cost is real and is accepted rather than hidden: in a grounded answer the model cannot say
// anything at all, not even something true and useful like "I could not read the desktop". What a human
// gets is the readings, and if a reading failed they get `failed` with the reason. Reading the readings
// back in the model's own words is a real capability with a real design question in it — what stops a
// fluent paraphrase from being a second opinion — and it is deliberately not attempted here.
//
// ## Termination, without a step counter
//
// There is no `MAX_AGENT_STEPS`. The invariant is stronger than a number and is the reason a number is
// not needed: **every iteration that continues must have consumed a capability that had not been read
// yet in this interaction.** To reach another model call, every call in the batch must have been a
// first read of its capability — a duplicate, an unknown name, a malformed call, or arguments all set
// the same stop flag, and the loop leaves after finishing that batch. `LANGUAGE_EXPOSURES` is the
// closed set, so the set of names that can be newly read is finite and shrinking, and the loop is
// bounded by its size: at most two reads and three model calls in this build.
//
// A number would have been worse in a way that matters. `LANGUAGE_EXPOSURES` is a decision somebody
// makes by editing a file; a step limit is a second number that has to be kept in step with the first,
// and when they disagree the one that is wrong is invisible — the loop just stops early, or the limit
// is quietly raised until it stops mattering. The invariant cannot come apart from the list, because
// the list is what it counts. When a capability that needs to be read twice exists, this is the code
// that has to be revisited, and it will say so.
//
// ## Wire completeness
//
// An OpenAI-compatible endpoint rejects a request outright if an assistant message's tool calls are not
// all answered by tool messages before the next request goes out. That is a property of the wire, not a
// rule this build chose, and getting it wrong produces a 400 that looks like a model problem. The loop
// is written so it cannot be got wrong: the batch is resolved in full — one tool message per call,
// including for the calls that were refused — *before* the stop decision is made. The `stopped` flag is
// set during resolution and read afterwards, so there is no arrangement of branches in which a call is
// left unanswered and another request is sent.
//
// The content of a refused call's tool message is fixed text and never the model's own words, and it is
// written even though no request will carry it: the batch is completed as a structural property rather
// than because something downstream happens to read it. If a later change ever makes the loop continue
// after a refused call, that message is already correct.
//
// ## Where a failure lands
//
// Three kinds, kept apart because the repairs differ. A step that throws is `failed` — the endpoint
// could not be reached or answered with something unreadable, and coming back later is the fix. A
// reading that throws is also `failed`, for the same reason at a different layer: the wiring is broken,
// not the question. A step that arrives intact but says nothing usable — empty text, no calls, nothing
// read — is `refused`, because the model spoke and this build could not act on it. The distinctions are
// the ones `plugin-design-spec.md` §13 already draws, and nothing new is invented for them.

import type { DialogueTurn } from './dialogue.js';
import { advanceDialogue, usableDialogueTurn } from './dialogue.js';
import type { GroundedBlock } from './express.js';
import {
  emptyQuestionLines,
  groundingFailureLines,
  longQuestionLines,
  modelFailureLines,
  renderAnswer,
  renderChat,
  truncatedLines,
  unclassifiedLines,
} from './express.js';
import type { ExposureReader } from './read.js';
import type { ModelMessage, ModelRequest, ModelStep, ModelTool } from './model.js';
import { buildSystemPrompt } from './prompt.js';
import { readCall, toModelTools } from './tools.js';
import type { LanguageReply } from './types.js';
import { MAX_LANGUAGE_TEXT_LENGTH } from './types.js';

/**
 * The one thing this plugin asks of a model, and everything it needs to act on the answer.
 *
 * `step` rather than `classify`, because there is no longer a single classification: an interaction is
 * a sequence of requests whose shape depends on what came back before, and the seam has to be able to
 * express that. A test writes the sequence down; the loop is what makes the sequence mean something.
 */
export interface LanguageDependencies {
  readonly step: (request: ModelRequest) => Promise<ModelStep>;
  readonly read: ExposureReader;
  readonly now: () => string;
}

export interface Answerer {
  answer(text: string): Promise<LanguageReply>;
}

// The tool message for a call that was not performed: a capability that does not exist, a capability
// already read this interaction, or a call carrying arguments. Fixed text, and it never quotes the
// model. It is not a diagnostic — every path that writes one also stops the interaction — so it says
// the only thing that is true of all three without naming any of them.
const UNRUN_CALL_RESULT = '这次调用没有执行。';

export function createAnswerer(dependencies: LanguageDependencies): Answerer {
  let turn: DialogueTurn | null = null;

  return {
    async answer(text: string): Promise<LanguageReply> {
      const now = dependencies.now();
      if (text.trim() === '') return { outcome: 'refused', lines: emptyQuestionLines() };
      if (text.length > MAX_LANGUAGE_TEXT_LENGTH) {
        return { outcome: 'refused', lines: longQuestionLines(MAX_LANGUAGE_TEXT_LENGTH) };
      }

      const contextUsed = usableDialogueTurn(turn, now);
      const messages: ModelMessage[] = [
        { role: 'system', content: buildSystemPrompt(contextUsed) },
        { role: 'user', content: text },
      ];
      const tools: readonly ModelTool[] = toModelTools();

      // What has been read, in the order it was read. This is the whole of the loop's memory and the
      // whole of the referent it may leave behind — one list serving both, so that "what was read" has
      // one home rather than two that could disagree.
      const blocks: GroundedBlock[] = [];
      const alreadyRead = (name: string): boolean => blocks.some((block) => block.name === name);

      for (;;) {
        let step: ModelStep;
        try {
          step = await dependencies.step({ messages, tools });
        } catch (error) {
          return { outcome: 'failed', lines: modelFailureLines(describe(error)) };
        }

        if (step.toolCalls.length === 0) {
          // Grounded: the model is done, and anything it wrote alongside being done is dropped. This is
          // the branch the one-way door is about, and it is `break` rather than a return precisely so
          // that the answer is assembled from the readings and not from the model.
          if (blocks.length > 0) break;

          // Nothing read, so this was a conversational turn — unless it was cut off, in which case what
          // arrived is a prefix of a sentence and showing it would show a human something the model did
          // not say.
          if (step.truncated) return { outcome: 'refused', lines: truncatedLines() };

          const chat = step.content.trim();
          if (chat === '') return { outcome: 'refused', lines: unclassifiedLines() };
          return { outcome: 'chatted', lines: renderChat(chat) };
        }

        // Echoed back with no content, so the model is not told it said something no human saw. The chain
        // of thought, if the endpoint produced one, goes back on this same message and only here: it is
        // read off the step, spent on the next request, and left behind with this array when the answer
        // ends. That the loop holds it for exactly as long as it holds the calls is the whole lifecycle —
        // there is no second place it is written, which is what keeps it from becoming something this
        // build keeps.
        messages.push({
          role: 'assistant',
          toolCalls: step.toolCalls,
          reasoningContent: step.reasoningContent,
        });

        let stopped = false;
        for (const call of step.toolCalls) {
          const exposure = readCall(call);
          if (exposure === undefined || alreadyRead(exposure.name)) {
            messages.push({ role: 'tool', toolCallId: call.id, content: UNRUN_CALL_RESULT });
            stopped = true;
            continue;
          }

          let lines: readonly string[];
          try {
            lines = await dependencies.read(exposure);
          } catch (error) {
            return { outcome: 'failed', lines: groundingFailureLines(describe(error)) };
          }

          blocks.push({ name: exposure.name, lines });
          // The model is shown exactly the lines the human will be shown. Not a summary of them, not
          // the raw contract value behind them — the same array, in the same order, because a model
          // told something the human was not could answer from a fact nobody else can see.
          messages.push({ role: 'tool', toolCallId: call.id, content: lines.join('\n') });
        }

        // Read after the batch, never during: the loop only leaves once every call has a tool message.
        // See the note at the top — this is the wire invariant, made structural.
        if (stopped) break;
      }

      if (blocks.length === 0) {
        // Reached only when the first batch held no call this build performs — an unknown capability or
        // a call carrying arguments, in some combination. A duplicate cannot land here: a repeated name
        // needs a first read of that name to be a repeat, so a batch containing one has already put a
        // block in `blocks` and leaves by the grounded path instead. Nothing was established, so nothing
        // is answered.
        return { outcome: 'refused', lines: unclassifiedLines() };
      }

      // Only a grounded answer moves the referent. A chat reply read nothing, so it has no subject to
      // lend and — just as importantly — no reason to clear one: a human who says "ayobro" between two
      // questions about their screen has not changed the subject.
      turn = advanceDialogue(
        blocks.map((block) => block.name),
        now,
      );
      return { outcome: 'answered', lines: renderAnswer(blocks, contextUsed) };
    },
  };
}

// Errors reach here from the transport, from a contract, or from a renderer, and all three are this
// repository's own code raising a message meant to be read. Anything that is not an `Error` is
// stringified rather than dropped, because a `throw 'x'` should not become an empty detail line.
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
