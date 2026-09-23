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
// Two variants, and the whole of the difference between them is one Service.
//
//   base Language               work-focus.current, desktop-session-awareness.peek
//   repository-aware Language   those two, plus repository-ci-relevance.current
//
// The base variant is what every resident with a model gets, and it is byte-for-byte the plugin this
// file has always built: same id, same version, same two requirements, same two exposures. A resident
// with no repository scope answers exactly what it answered before this slice, and nothing about the
// repository-aware variant reaches it.
//
// The repository-aware variant is what a resident gets when a repository scope *and* a model were both
// configured. It offers one more capability, so it depends on the Service behind that capability, and
// the dependency is hard. That hardness is the v0 semantics and not an oversight: the Runtime has no
// optional requirement — `#requirementsSatisfied` is an `every` — so a repository-aware Language loaded
// into a composition without the relevance plugin stays `waiting`, and a resident with a waiting member
// is not ready and exits rather than coming up with a capability that would fail the first time a model
// asked for it. Fail-closed is the honest shape, and the alternative would be an optional-require
// mechanism, a service locator, a capability registry, dynamic discovery or a generic optional-plugin
// framework — four pieces of Runtime architecture this slice is explicitly not allowed to add, and none
// of which the problem actually needs.
//
// What that does *not* mean, recorded because it is the easiest thing to misread: base Language does not
// depend on Repository CI. With no repository scope `LANGUAGE_EXPOSURES` is unchanged and the plugin
// offering it is unchanged, so the dependency lives in the variant that offers the capability and
// nowhere else. That is what keeps "is there a repository scope" a composition decision rather than a
// condition this plugin evaluates, and it is why the resident selects a variant instead of the plugin
// negotiating one.
//
// Two named factories rather than a flag or an options bag, for the reason `exposure.ts` records at
// length: the mechanism is approved for exactly two variants differing by one independently optional
// capability. A second such capability is the trigger for a Composition Boundary Review — not for a
// third factory here, and not for a `CalendarLanguage` beside these two.
//
// The peek contract rather than the current one, for the reason `desktop-session-observe` gives: a
// question a human asks must not become the next comparison partner of the timeline they are asking
// about. Holding `peek()` makes that a property of what this plugin was given rather than a rule it
// follows — there is no code path here that could advance the baseline, so no test has to prove one
// does not.
//
// No Service is provided by either variant, and by the Contract Creation Gate there is nothing to
// provide. Nothing in the composition asks this plugin for anything: the one thing that does is a
// person, arriving over the endpoint below. Publishing a Service for that would be publishing one for
// nobody, and the day a real consumer exists is the day this line gets an argument rather than a guess.
// Offering a capability to a model and providing one to the composition are different directions, and
// this plugin only ever does the first.
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

import type { ServiceContract } from '../runtime/contracts.js';
import type { PluginContext, PluginDefinition } from '../runtime/plugin.js';
import { desktopSessionAwarenessPeekService } from '../desktop-session-awareness/index.js';
import { repositoryCiRelevanceService } from '../repository-ci-relevance/index.js';
import { workFocusCurrentService } from '../work-focus/index.js';

import { createAnswerer } from './answer.js';
import { listenLanguageEndpoint } from './endpoint.js';
import { languageEndpointPath } from './endpoint-path.js';
import { LanguageError } from './errors.js';
import { LANGUAGE_EXPOSURES, LANGUAGE_REPOSITORY_EXPOSURES } from './exposure.js';
import type { LanguageExposure } from './exposure.js';
import {
  REASONING_EFFORTS,
  createHttpModel,
  readModelCredential,
  type LanguageModel,
  type LanguageModelConnection,
  type ReasoningEffort,
} from './model.js';
import { createExposureReader, createRepositoryExposureReader } from './read.js';
import type { ExposureReader } from './read.js';

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
 * One variant: what it requires, what it offers, and how it reads.
 *
 * The three travel in one object literal per variant because they have to agree, and this is what makes
 * "these three agree" checkable by reading one place instead of cross-referencing three. The two objects
 * below are the whole set: nothing outside this file constructs one, and a third would be the trigger for
 * a Composition Boundary Review rather than a third entry.
 */
interface LanguageVariant {
  /** The Services this variant reads. Everything it offers has to be reachable through one of these. */
  readonly requires: readonly ServiceContract<unknown>[];
  /** The capabilities it offers, in the order a model is shown them. */
  readonly exposures: readonly LanguageExposure[];
  /**
   * Build this variant's reader, once, at activation.
   *
   * Takes the Runtime's plugin context so it can pull the Services the `requires` above names. A reader
   * that reached a Service outside that list would be holding something this build was never granted,
   * which is why the pulling happens here rather than anywhere the reader could influence it.
   */
  readonly makeReader: (context: PluginContext) => ExposureReader;
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
 *
 * The variant is the second thing a caller chooses, and it is a whole `LanguageVariant` rather than a
 * flag. The two factories below are the only callers, so what a boolean would buy — a choice made at
 * some third site — is exactly what should not exist here.
 */
function buildLanguagePlugin(
  createModel: (connection: LanguageModelConnection) => LanguageModel,
  variant: LanguageVariant,
): PluginDefinition<LanguagePluginConfig> {
  return {
    id: 'language',
    version: '1.0.0',
    // The variant's own list and nothing else. What is *absent* from both variants is the argument: no
    // Memory, no Chronicle, no Runtime service that would make this a place other plugins reach in.
    requires: variant.requires,
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

      // The reader is the only thing in this plugin that knows which Service an exposure points at,
      // and it is handed contract calls rather than Service objects — a reader that could reach a
      // Service could reach one this build was never granted. The variant builds it, so that the
      // Services it pulls and the `requires` it declares are written in the same object literal, and
      // anyone checking that the two agree reads one place rather than two files.
      const read = variant.makeReader(context);

      // Four dependencies are wired here and nowhere else, and the loop they feed keeps its own
      // dialogue turn — see `answer.ts` for why the decisions live in a plain function instead of this
      // closure. Nothing below this line decides what a question means; this is the wiring, and the
      // wiring is the whole of it.
      const answerer = createAnswerer({
        step: (request) => model.step(request),
        read,
        now: () => new Date().toISOString(),
        exposures: variant.exposures,
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

/**
 * The base variant: the two reads that need nothing beyond the pair this plugin has always required.
 *
 * A resident with a model and no repository scope gets this one, and it is the plugin every build before
 * this slice built — same id, same version, same two requirements, same two exposures.
 *
 * Exported, and for the reason `index.ts` gives for exporting `createAnswerer`: on `ubuntu-latest` the
 * platform gate in `setup` refuses before anything under it runs, so a wiring that only `setup` could
 * observe would be a wiring CI never checks. What a test reads here is the object
 * `createLanguagePlugin` hands `buildLanguagePlugin`, so "the base variant offers two capabilities and
 * reads them through the base reader" is a statement about the plugin rather than about the literals it
 * was assembled from — and the two can differ, which is the version of this that matters: a variant
 * built from the other list is a plugin whose model is shown a capability its own reader refuses.
 *
 * Two named objects rather than a table of them. A third variant is the trigger for a Composition
 * Boundary Review — see `exposure.ts` — and not a third entry here.
 */
export const baseLanguageVariant: LanguageVariant = Object.freeze({
  requires: [workFocusCurrentService, desktopSessionAwarenessPeekService],
  exposures: LANGUAGE_EXPOSURES,
  makeReader: (context: PluginContext) => {
    const focus = context.services.get(workFocusCurrentService);
    const awareness = context.services.get(desktopSessionAwarenessPeekService);

    return createExposureReader({
      readFocus: () => focus.current(),
      peek: () => awareness.peek(),
    });
  },
});

/**
 * The base variant, as the plugin a composition loads.
 *
 * The factory is here rather than at the definition because the model connection is injected — see
 * `buildLanguagePlugin` for why that seam exists — and everything the variant itself decides lives in
 * the object above, so that there is one place to read for what this plugin requires and one for what it
 * offers.
 */
export function createLanguagePlugin(
  createModel: (connection: LanguageModelConnection) => LanguageModel,
): PluginDefinition<LanguagePluginConfig> {
  return buildLanguagePlugin(createModel, baseLanguageVariant);
}

/**
 * The repository-aware variant: the base two, plus the Repository CI relevance judgement.
 *
 * Loaded only by a composition that has already loaded the plugin providing
 * `repositoryCiRelevanceService`, and that ordering decision lives in `cli/resident.ts` rather than
 * here — this variant states the need and the Runtime reconciles it. Because it is a hard requirement,
 * a composition that got the order wrong does not come up degraded: this plugin stays `waiting`, the
 * resident reports it, and an operator sees which member is missing instead of a capability that fails
 * the first time a model asks for it.
 *
 * The two base reads are pulled here a second time, in this literal, rather than shared with the base
 * variant. That is deliberate: each variant states its own requirements in full, so a reader comparing
 * a variant's reader against its `requires` never has to follow a second definition to know what the
 * services it pulls are.
 *
 * Exported for the reason the base variant records above, and it is the half that needs it more: this is
 * the variant whose third capability can be offered without a reader that can read it, which is a
 * mismatch that shows up on the first question a model asks rather than at activation.
 */
export const repositoryLanguageVariant: LanguageVariant = Object.freeze({
  requires: [
    workFocusCurrentService,
    desktopSessionAwarenessPeekService,
    repositoryCiRelevanceService,
  ],
  exposures: LANGUAGE_REPOSITORY_EXPOSURES,
  makeReader: (context: PluginContext) => {
    const focus = context.services.get(workFocusCurrentService);
    const awareness = context.services.get(desktopSessionAwarenessPeekService);
    const relevance = context.services.get(repositoryCiRelevanceService);

    return createRepositoryExposureReader({
      readFocus: () => focus.current(),
      peek: () => awareness.peek(),
      readRelevance: () => relevance.current(),
    });
  },
});

/** The repository-aware variant, as the plugin a composition loads. See the factory above. */
export function createRepositoryLanguagePlugin(
  createModel: (connection: LanguageModelConnection) => LanguageModel,
): PluginDefinition<LanguagePluginConfig> {
  return buildLanguagePlugin(createModel, repositoryLanguageVariant);
}

export const languagePlugin: PluginDefinition<LanguagePluginConfig> = createLanguagePlugin((connection) =>
  createHttpModel(connection),
);

export const repositoryLanguagePlugin: PluginDefinition<LanguagePluginConfig> =
  createRepositoryLanguagePlugin((connection) => createHttpModel(connection));
