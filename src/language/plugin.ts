// Talking with the person who runs Hikari, as a plugin.
//
// One concern, three parts, one plugin: running the loop (natural language in, a conversation or a set
// of readings out), the short-term context a follow-up needs, and expressing a grounded domain result
// back to a human. They are one plugin because they are one act — a person asks a question and gets an
// answer — and splitting them would create two things that have to agree about what a question was,
// which is a contract nobody has asked for.
//
// What this plugin is not, and the list is here because each entry is a thing it would have been easy
// to become: it is not a brain, a planner, an action orchestrator, a tool registry, a capability
// registry, a global context, memory, a model router or a reasoning service. It answers questions
// about facts other plugins already established. It reads; it does not write. `ask` is the only word
// it speaks and every one of those roles would need a second.
//
// The loop it now runs makes that list worth re-reading rather than assuming, because "the model picks
// a tool" is the shape most of those roles arrive in. Three things keep it from being any of them, and
// all three are structural. The set of things the model may pick from is a frozen literal in
// `exposure.ts`, not a registry it can be added to at runtime — there is no `register`, no discovery
// and no enumeration of the Runtime. The set is consumed by a `find` over that literal, not by handing
// a name to a Service lookup — a string a model wrote can never become a key. And the loop's only move
// is "read a thing I have not read"; it does not plan, it cannot write, and it cannot act. What is left
// is a conventional agent loop inside one plugin, which `core-architecture-v0.md` allows by name.
//
// This file is the wiring — config, endpoint, model connection, and the four dependencies the pipeline
// is handed — and deliberately not the decisions. Those are in `answer.ts`, as a plain function, because
// CI runs on Linux where none of this file's machinery exists: a rule that could only be reached through
// a named pipe would be a rule CI never checks. What lives here is the part that genuinely needs a
// process, a socket and a network connection, and nothing else was allowed to move in with it.
//
// Two dependencies, and the boundary of this slice is exactly that pair.
//
//   work-focus.current              the set a human declared, as they typed it
//   desktop-session-awareness.peek  the desktop assessment, computed without advancing its baseline
//
// Repository CI is deliberately not among them, and the reason is structural rather than editorial.
// The Runtime has no optional requirement: `#requirementsSatisfied` is an `every`, so a plugin that
// required a contract nobody provides stays `waiting`, and a resident with one waiting member is not
// ready and exits. Requiring the relevance contract would therefore mean a default resident could not
// load Language at all — and making *that* work would mean either an optional-require mechanism or a
// capability registry, two pieces of Runtime architecture this slice is not allowed to add. So
// Language can answer about the work focus itself and about the desktop, and cannot answer about CI.
// That is a smaller capability and an honest one, and it is recorded as a limit rather than papered
// over with a feature.
//
// The peek contract rather than the current one, for the reason `desktop-session-observe` gives: a
// question a human asks must not become the next comparison partner of the timeline they are asking
// about. Holding `peek()` makes that a property of what this plugin was given rather than a rule it
// follows — there is no code path here that could advance the baseline, so no test has to prove one
// does not.
//
// No Service is provided, and by the Contract Creation Gate there is nothing to provide. Nothing in
// the composition asks this plugin for anything: the one thing that does is a person, arriving over the
// endpoint below. Publishing a Service for that would be publishing one for nobody, and the day a real
// consumer exists is the day this line gets an argument rather than a guess.
//
// The endpoint is the plugin's own, over the same named-pipe precedent every other plugin-owned
// ingress uses. The CLI is a transport client: it carries the sentence in and the lines out and forms
// no opinion about either. The Resident's control channel is deliberately not involved — a channel
// whose whole design is two words about the process must not become a place where questions are
// routed to plugins, because the first question it answered would make it the router that design
// refuses to be.
//
// Nothing durable is held. The model connection is this activation's, the dialogue turn is this
// activation's, and the endpoint is gone when the activation ends; there is no file, no store and no
// Chronicle entry anywhere behind this plugin, so "Hikari forgot the conversation because it
// restarted" is a structural fact rather than a cleanup somebody has to remember to run.

import type { PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionAwarenessPeekService } from '../desktop-session-awareness/index.js';
import { workFocusCurrentService } from '../work-focus/index.js';

import { createAnswerer } from './answer.js';
import { listenLanguageEndpoint } from './endpoint.js';
import { languageEndpointPath } from './endpoint-path.js';
import { LanguageError } from './errors.js';
import {
  REASONING_EFFORTS,
  createHttpModel,
  readModelCredential,
  type LanguageModel,
  type LanguageModelConnection,
  type ReasoningEffort,
} from './model.js';
import { createExposureReader } from './read.js';

/**
 * What the composition must tell this plugin: where its endpoint goes, which model to ask, and how much
 * reasoning to ask it for.
 *
 * Every field is required and none has a default, and two of them may be absent: a model served on this
 * machine needs no credential, and an endpoint that has never heard of `reasoning_effort` needs no
 * effort configured. Absence is spelled `undefined` rather than given a placeholder, because both of
 * these mean "send nothing" and neither has a value that would say the same thing.
 *
 * `credentialEnv` is a variable *name* and not a secret — the value is read once in `setup` and lives in
 * the model connection's closure, never in this config, which is the object a test constructs and a
 * status line could reach.
 */
export interface LanguagePluginConfig {
  readonly rootDir: string;
  readonly endpoint: string;
  readonly model: string;
  readonly credentialEnv: string | undefined;
  /**
   * Which reasoning effort to ask for, or `undefined` to ask for nothing.
   *
   * A configuration *value* rather than a provider choice made here: this plugin does not know which
   * endpoint is on the other end and must not guess, so whether to send the field and what to put in it
   * are the operator's sentence, carried through untouched. See `ReasoningEffort` for which values this
   * build accepts and why the rest are refused here rather than forwarded.
   */
  readonly reasoningEffort: ReasoningEffort | undefined;
}

/**
 * The model factory is injected rather than constructed here, and the seam exists for the reason
 * `github-ci/plugin.ts` gives for its acquirer: the behaviour of this plugin has to be testable
 * without a network. Every question about whether a model's words can reach a human is a question
 * about what happens to the model's answer, and a test answers it by choosing that answer rather than
 * by standing up something that pretends to be a model.
 *
 * Since the loop landed the seam carries more than it used to. A single classification could be tested
 * by choosing one string; a loop can only be tested by choosing a *sequence*, and the factory is what
 * lets a test write one down — including the sequences no real endpoint would produce, which are the
 * ones the termination and batch-completeness rules are about.
 */
export function createLanguagePlugin(
  createModel: (connection: LanguageModelConnection) => LanguageModel,
): PluginDefinition<LanguagePluginConfig> {
  return {
    id: 'language',
    version: '1.0.0',
    // The frozen pair, and nothing else. What is *absent* here is the argument: no Repository CI, no
    // Memory, no Chronicle, no Runtime service that would make this a place other plugins reach in.
    requires: [workFocusCurrentService, desktopSessionAwarenessPeekService],
    provides: [],
    config: {
      parse(input: unknown): LanguagePluginConfig {
        return readConfig(input);
      },
    },
    async setup(context, config) {
      const path = languageEndpointPath(config.rootDir);
      if (path === undefined) {
        // This plugin's own platform question, asked once, where the capability is owned — the same
        // shape `work-focus` and `desktop-session-observe` use.
        throw new LanguageError('语言入口依赖 Windows 命名管道，本机没有。');
      }

      // The credential is resolved here, once, from the variable the operator named. It becomes a value
      // in the connection and goes no further: it is not put in `config`, not in a status line, and not
      // in any message this plugin can construct. A variable that was named and has no value throws
      // here, so a misconfigured credential is a plugin that refused to start rather than a resident
      // that answers questions unauthenticated.
      const credential = readModelCredential(config.credentialEnv);
      const model = createModel({
        endpoint: config.endpoint,
        model: config.model,
        credential,
        reasoningEffort: config.reasoningEffort,
      });

      // Registered before the endpoint, so the Runtime's LIFO teardown disposes the model *after* the
      // ingress is gone: a question already being answered keeps its connection until it is done, and
      // nothing new can arrive to find the model aborted.
      context.defer(() => model.dispose());

      const focus = context.services.get(workFocusCurrentService);
      const awareness = context.services.get(desktopSessionAwarenessPeekService);

      // The reader is the only thing in this plugin that knows which Service an exposure points at,
      // and it is handed the two contract calls rather than the two Services — a reader that could
      // reach a Service object could reach one this build was never granted. It is built here, beside
      // the `requires` above, so the two are read together by anyone checking that they agree.
      const read = createExposureReader({
        readFocus: () => focus.current(),
        peek: () => awareness.peek(),
      });

      // Three dependencies are wired here and nowhere else, and the loop they feed keeps its own
      // dialogue turn — see `answer.ts` for why the decisions live in a plain function instead of this
      // closure. Nothing below this line decides what a question means; this is the wiring, and the
      // wiring is the whole of it.
      const answerer = createAnswerer({
        step: (request) => model.step(request),
        read,
        now: () => new Date().toISOString(),
      });

      const endpoint = await listenLanguageEndpoint(
        {
          handle: (request) => answerer.answer(request.text),
        },
        path,
      );
      context.defer(() => endpoint.close());
    },
  };
}

// Everything wrong with this config is a reason not to start, and all of it is checked here rather than
// trusted. A half-configured plugin that activated and then failed every question would put the failure
// at the wrong end of the pipe: the operator would learn about a typo when they asked something, in a
// message about understanding, rather than when the resident refused to come up.
function readConfig(input: unknown): LanguagePluginConfig {
  if (typeof input !== 'object' || input === null) {
    throw new LanguageError('语言插件需要一个配置对象。');
  }

  const { rootDir, endpoint, model, credentialEnv, reasoningEffort } = input as {
    rootDir?: unknown;
    endpoint?: unknown;
    model?: unknown;
    credentialEnv?: unknown;
    reasoningEffort?: unknown;
  };

  if (typeof rootDir !== 'string' || !rootDir.trim()) {
    throw new LanguageError('语言插件需要一个非空的 rootDir。');
  }
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new LanguageError('语言插件需要一个非空的 model endpoint。');
  }
  if (typeof model !== 'string' || !model.trim()) {
    throw new LanguageError('语言插件需要一个非空的 model。');
  }
  if (credentialEnv !== undefined && (typeof credentialEnv !== 'string' || !credentialEnv.trim())) {
    throw new LanguageError('语言插件的 credentialEnv 必须是非空字符串，或者省略。');
  }
  // The closed set, checked at the one place an operator's string becomes a value. The two failures a
  // typo would otherwise cause are both worse than a refusal here: an endpoint that does not recognise
  // the value may reject the request, and this build deliberately never reads an error body, so the
  // operator would see a status code and no reason; or it may ignore the value and answer normally,
  // which is a request that quietly did not say what the operator believes it said.
  //
  // Membership is asked of the owner's table and the message is built from it, rather than the check
  // naming a member and the message naming it again. `none` is therefore written once in `model.ts`,
  // where the union is, and the day a second effort exists this branch is already correct.
  if (
    reasoningEffort !== undefined &&
    (typeof reasoningEffort !== 'string' || !Object.hasOwn(REASONING_EFFORTS, reasoningEffort))
  ) {
    throw new LanguageError(
      `语言插件的 reasoningEffort 只能是 ${Object.keys(REASONING_EFFORTS).join(' / ')}，或者省略。`,
    );
  }

  return Object.freeze({
    rootDir,
    endpoint,
    model,
    credentialEnv: credentialEnv as string | undefined,
    reasoningEffort: reasoningEffort as ReasoningEffort | undefined,
  });
}

export const languagePlugin: PluginDefinition<LanguagePluginConfig> = createLanguagePlugin((connection) =>
  createHttpModel(connection),
);
