// The loop: a human's sentence in, either a conversation or a set of readings out.
//
// This is the whole of the autonomy this plugin has, and it is worth stating exactly how much that is.
// The model decides **what to read next**. It does not decide what the readings mean, whether they are
// good news, or what the human is probably doing. Every line a human sees in a grounded answer is either
// an owner's rendering or — on the one path `## The two states` records — the model's own sentence, in a
// section that says it is not a rendering; the model's prose is discarded the moment a reading exists
// unless three conditions hold, and each of them is written down where it is checked.
// `core-architecture-v0.md` allows a conventional agent loop *inside* an autonomous
// plugin as long as it does not stand for Hikari, and the shape of this one is what keeps that boundary
// from being a promise: the loop's only move is "read a thing I have not read", and its only other
// outcome is "stop".
//
// ## The two states, and the one-way door between them
//
// An interaction starts open. The model may talk, or it may read, and both are complete answers: talk
// is `chatted`, a reading is `answered`. The moment one read succeeds, that door closes for the rest of
// the interaction and does not reopen — with the single exception written down under `## The one
// condition under which the door opens` below, which is the only place in this file that grants
// anything, and which a reader should have in hand before treating the rule as unconditional. From then
// on the only things the model can do are call another
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
// gets is the readings, and if a reading failed they get `failed` with the reason.
//
// ## The one condition under which the door opens
//
// The paragraph above used to end there, and the sentence it ended on is the reason it no longer does:
// "reading the readings back in the model's own words is a real capability with a real design question
// in it — what stops a fluent paraphrase from being a second opinion — and it is deliberately not
// attempted here." That question still has no answer, and this file still does not attempt to answer it.
//
// What changed is that a second kind of material now reaches the model's context. Until a machine has a
// confirmed statement on file, the readings *are* everything the model was given, so a sentence the model
// adds to them can only be a sentence about them — the judgement the paragraph above refuses to make. Once
// there is a record, the model is holding two things, and a person's question can genuinely be about
// both at once. Answering half of it is the failure this round repairs; the door's cost was being paid
// for a question nobody had asked.
//
// So the door opens exactly once, and only here, and only when all three of these hold: this person has
// at least one confirmed statement; the step is not truncated; and the model actually wrote something.
// The third condition's consequences are the ones to watch for a later reader — a model that says
// nothing gets nothing, which keeps every silent grounded interaction byte-for-byte what it was.
//
// What the model's sentence is *not* is a licence. It is printed after every reading rather than between
// two of them, under a fixed label that says the lines are its own words and that the record it may be
// drawing on was never verified. That label answers the design question above by declining to answer it:
// nothing here checks whether a given sentence is a paraphrase of a reading or a claim about one, so the
// label claims the one thing that is true of every line it leads — that these lines are not readings —
// and leaves the weighing to the reader. `express.ts` states that distinction in full.
//
// ## Termination, without a step counter
//
// There is no `MAX_AGENT_STEPS`. The invariant is stronger than a number and is the reason a number is
// not needed: **every iteration that continues must have consumed a capability that had not been read
// yet in this interaction.** To reach another model call, every call in the batch must have been a
// first read of its capability — a duplicate, an unknown name, a malformed call, or arguments all set
// the same stop flag, and the loop leaves after finishing that batch. The exposure list handed in is the
// closed set, so the set of names that can be newly read is finite and shrinking, and the loop is
// bounded by its size: at most as many reads as that list has entries, and one model call more than that.
// Both numbers are facts about the list rather than about this file, which is why neither is written
// down here.
//
// That list is a dependency rather than an import for the same reason. A base variant and a
// repository-aware variant run this same loop over different closed sets, and a loop that reached for a
// module-level list would be a loop that had decided which variant it was in — the decision belongs to
// the plugin that built it, one file up. Nothing else here changes: `answer.ts` never learns what a
// variant is, and could not act differently if it did.
//
// A number would have been worse in a way that matters. The exposure list is a decision somebody
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

import type { ConfirmedDecision } from './continuity.js';
import type { DialogueTurn } from './dialogue.js';
import { advanceDialogue, usableDialogueTurn } from './dialogue.js';
import type { GroundedBlock } from './express.js';
import {
  describe,
  emptyQuestionLines,
  groundingFailureLines,
  longQuestionLines,
  modelFailureLines,
  renderAnswer,
  renderChat,
  renderSynthesis,
  truncatedLines,
  unclassifiedLines,
} from './express.js';
import type { LanguageExposure } from './exposure.js';
import type { ExposureReader } from './read.js';
import type { ModelMessage, ModelRequest, ModelStep, ModelTool } from './model.js';
import { buildSystemPrompt, promptListsRecord } from './prompt.js';
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
  /**
   * The closed set this loop runs over: what the model is offered, and what it will act on.
   *
   * One array serving both, rather than a set to offer and a lookup to resolve — see `tools.ts`. It is a
   * dependency rather than an import so that the loop is the same loop in every variant, and the choice
   * of variant is made once, by the plugin that constructed these dependencies.
   */
  readonly exposures: readonly LanguageExposure[];
  /**
   * What this person has confirmed before, oldest first — the plugin's own durable history, as its owner
   * keeps it.
   *
   * A function rather than an array because the list grows during the activation: a `confirm` writes a
   * record, and the next question in the same process should be able to answer from it. Handing the loop
   * a snapshot at construction would make the record invisible until the next restart, which is a
   * behavior nobody asked for and which would be invisible in the code.
   *
   * Read on every turn rather than only when the list is empty, and that is not an oversight: a turn that
   * read nothing and a turn that read something both get the same system message, so the record frames
   * the same context either way. What it does *not* do is move the referent — the record is material,
   * not a reading, and `turn` below is advanced only by reads.
   */
  readonly decisions: () => readonly ConfirmedDecision[];
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
      // Read once and held, because the same list decides two things: what the system message carries,
      // and whether there is any material for a composed section to be about. Both are decided *here*,
      // synchronously and before the model is called — and not because calling a dependency twice would
      // be expensive. `decisions()` hands back a live view of this activation's own store rather than a
      // copy, and this endpoint serves one connection at a time with no serialization between them: a
      // `confirm` arriving on another connection while this ask waits on the model pushes onto the very
      // array this binding points at. Reading its length after the model answered would let the gate see
      // a record the prompt never listed, and the composed section would then be labelled as drawing on
      // this person's words in an answer where their words were never shown. `promptListsRecord` rather
      // than a length test, for the neighbouring reason: what the page carries is what the selection
      // kept, so the gate has to be a question about the page and not about the store.
      const confirmed = dependencies.decisions();
      const recordOnThePage = promptListsRecord(confirmed);
      const messages: ModelMessage[] = [
        { role: 'system', content: buildSystemPrompt(contextUsed, confirmed) },
        { role: 'user', content: text },
      ];
      const tools: readonly ModelTool[] = toModelTools(dependencies.exposures);

      // What has been read, in the order it was read. This is the whole of the loop's memory and the
      // whole of the referent it may leave behind — one list serving both, so that "what was read" has
      // one home rather than two that could disagree.
      const blocks: GroundedBlock[] = [];
      const alreadyRead = (name: string): boolean => blocks.some((block) => block.name === name);
      // The model's own sentence, on the one path where it survives the loop. `undefined` means the
      // answer is the readings, which is what it was before this existed.
      let synthesis: string | undefined;

      for (;;) {
        let step: ModelStep;
        try {
          step = await dependencies.step({ messages, tools });
        } catch (error) {
          return { outcome: 'failed', lines: modelFailureLines(describe(error)) };
        }

        if (step.toolCalls.length === 0) {
          // Grounded: the model is done, and what it wrote alongside being done is normally dropped.
          // This is the branch the one-way door is about, and it is `break` rather than a return
          // precisely so that the answer is assembled from the readings and not from the model.
          //
          // It is also the only place that door opens, and the three conditions under it are what keep
          // the opening narrow. It is *this* break and not the one below: the `stopped` exit leaves with
          // a step that both wrote and called, and that step's content is not only hidden from the human
          // but never echoed back to the model either (`messages.push` below carries no content), so
          // reading it here would surface a sentence the loop deliberately made invisible twice.
          //
          // Truncation is excluded because `truncatedLines` records the rule for the chat path and it
          // does not stop applying here: a partial sentence is something the model did not finish
          // saying, and the missing half would be invisible exactly where the label says "these are my
          // words". The record's presence gates it because that is the material this section exists for
          // — and it is asked as "did the prompt put the record in front of the model" rather than "is
          // there a record", so that the gate cannot open onto a page that shows nobody's words. A
          // machine with no record has no route in its prompt and no exception to exercise: it gets an
          // answer that is byte-for-byte what it got before this existed.
          if (blocks.length > 0) {
            if (recordOnThePage && !step.truncated) {
              const spoken = step.content.trim();
              if (spoken !== '') synthesis = spoken;
            }
            break;
          }

          // Nothing read, so this was a conversational turn — unless it was cut off, in which case what
          // arrived is a prefix of a sentence and showing it would show a human something the model did
          // not say.
          if (step.truncated) return { outcome: 'refused', lines: truncatedLines() };

          const chat = step.content.trim();
          if (chat === '')
            return { outcome: 'refused', lines: unclassifiedLines(dependencies.exposures) };
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
          const exposure = readCall(call, dependencies.exposures);
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
        return { outcome: 'refused', lines: unclassifiedLines(dependencies.exposures) };
      }

      // Only a grounded answer moves the referent. A chat reply read nothing, so it has no subject to
      // lend and — just as importantly — no reason to clear one: a human who says "ayobro" between two
      // questions about their screen has not changed the subject.
      turn = advanceDialogue(
        blocks.map((block) => block.name),
        now,
      );
      // Composed here rather than inside `renderAnswer`, and that placement is deliberate rather than
      // convenient. `renderAnswer` has two other callers — the proactive surfaces in
      // `desktop-return-attention` and `repository-ci-attention` — which are not answers to a question
      // and have no model text to place; giving it a third parameter would put a shape they never use
      // into the signature of the one function all three share, and would make the composed answer the
      // thing a reader of `renderAnswer` has to hold in mind while checking the other two.
      const answer = renderAnswer(blocks, contextUsed);
      return {
        outcome: 'answered',
        lines: synthesis === undefined ? answer : [...answer, ...renderSynthesis(synthesis)],
      };
    },
  };
}

// `describe` used to live here and now comes from `express.ts`. Errors reach the loop from the
// transport, from a contract, or from a renderer, and all three are this repository's own code raising a
// message meant to be read. It moved because the `confirm` path needs the same rendering for the same
// kinds of error and `continuity.ts` cannot import from this file without the answer loop and the
// recording act becoming one module. The body is unchanged; only its home is.
