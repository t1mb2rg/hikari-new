// The tool list a model is given, and the lookup that reads one of its answers back.
//
// Both halves are mechanical, and that is the whole design. The list is a *parameter*: `toModelTool`
// turns each entry into the wire shape an OpenAI-compatible endpoint expects, and `findExposure` turns a
// name a model wrote back into the entry itself. Nothing in this file holds a list of its own and nothing
// in it can prefer one, which makes the variant split structural rather than a condition somebody has to
// remember — a base variant and a repository-aware variant pass different arrays to the same three
// functions. Nothing here decides anything about a domain either: there is no description text in this
// file, because the description is the owner's and is passed through by reference, and no list of legal
// names, because the legal names *are* whichever exposures were passed in. A name that matches no entry
// is not a rejected name — it is a name this plugin has never heard of, and the two cases are the same
// branch here.
//
// The parameters object is the one place this file says something in its own words, and for most of the
// capabilities in this build what it says is "nothing": they are zero-argument reads, and the schema for
// one is an object that accepts no properties. A model that tries to send an argument to one of those
// therefore fails against the endpoint rather than against a validator of ours, which is the smaller thing
// to own — `readArguments` then re-checks it on the way back, since the wire is the wire and
// `additionalProperties: false` is a request rather than a guarantee.
//
// One capability is not one of those. `authorized_repository_read` is the first read in this build that
// takes an argument, which `exposure.ts` predicted would make it the one that decides what an argument
// looks like, and what it decided is one named string. This file's whole share of that decision is the
// translation below: an owner declares a name and a description, and the schema is built from the
// declaration rather than invented here. What is still deliberately absent is a schema *language* — there
// is no per-capability input type to generate from, no `LanguageTool`-shaped descriptor carrying fields
// the wire does not have, no registry to look names up in, and no argument validation beyond the rules
// below. A second argument shape is a thing to write when a second capability needs one.

import type { LanguageExposure } from './exposure.js';
import type { ModelTool, ModelToolCall } from './model.js';

/**
 * What an exposure may declare about the one argument its capability takes.
 *
 * Declared structurally here rather than imported from an owner, for the reason the union in `exposure.ts`
 * is written the other way round: an owner states the shape of its own capability, and this file states
 * only what it needs in order to build a tool from one. An owner that grew a second argument field would
 * still be safe — this file would simply not read it — which is the same asymmetry `additionalProperties`
 * has on the wire.
 */
export interface DeclaredArgument {
  readonly name: string;
  readonly description: string;
}

/**
 * The rule for a call's arguments, as a closed set.
 *
 * `none` and `given` are the two values that let a call proceed; a capability that declares no argument
 * reads `none`, and one that declares an argument reads `given`. The third is separated because it is a
 * different sentence to whoever reads the log, not because it is handled differently — everything that is
 * not one of the first two stops the same way.
 *
 * The `given` case carries the name and the value rather than a record, because this build supports
 * exactly one argument and a record would be a general shape standing in for a specific fact. When a
 * capability needs two, the type is where that shows up first.
 */
export type ArgumentReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'given'; readonly name: string; readonly value: string }
  | { readonly kind: 'malformed' };

/**
 * Read the `arguments` string an OpenAI-compatible endpoint returns for a tool call.
 *
 * For a capability that declares no argument the rule is the one the mandate states — "no arguments" —
 * and that is a stricter thing than "these arguments are valid": the empty string, whitespace, and `{}`
 * all mean the model sent nothing, and anything else means it sent something. It does not matter whether
 * what it sent would have been legal for some other capability — an object with a key in it is a call
 * asking for something this capability does not take, and it is refused rather than ignored. Silently
 * dropping the arguments and performing the read anyway would answer a question the model did not ask.
 *
 * For a capability that declares one, the rule is the declaration: exactly one key, exactly that name, a
 * string, non-blank. Nothing is defaulted and nothing else is accepted, so a call that renamed the
 * argument or sent a second one is malformed rather than a call this build guesses at. The value is
 * trimmed, because whitespace around a path is not part of the path and a caller that meant `" /a"` meant
 * `/a`; what the reply echoes is the trimmed value, so the reading and the answer agree about which path
 * was read.
 */
export function readArguments(raw: string, argument?: DeclaredArgument): ArgumentReading {
  const text = raw.trim();
  if (text === '') {
    return argument === undefined ? { kind: 'none' } : { kind: 'malformed' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'malformed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'malformed' };
  const keys = Object.keys(parsed);
  if (argument === undefined) {
    return keys.length === 0 ? { kind: 'none' } : { kind: 'malformed' };
  }
  if (keys.length !== 1 || keys[0] !== argument.name) return { kind: 'malformed' };
  const value = (parsed as Readonly<Record<string, unknown>>)[argument.name];
  if (typeof value !== 'string') return { kind: 'malformed' };
  const trimmed = value.trim();
  if (trimmed === '') return { kind: 'malformed' };
  return { kind: 'given', name: argument.name, value: trimmed };
}

/**
 * Find the exposure a model named, or `undefined` when it named something this variant does not offer.
 *
 * The comparison is against the list it was handed rather than against a copy of the names or against
 * some larger set it could consult, so a name that is not offered to this model is not found and cannot
 * become found by anything other than the caller passing a longer list. Lookup is linear because the
 * list is five entries long at most and a map would be a second structure to keep in step with the
 * first.
 */
export function findExposure(
  name: string,
  exposures: readonly LanguageExposure[],
): LanguageExposure | undefined {
  return exposures.find((exposure) => exposure.name === name);
}

/**
 * The `tools` array for a model request: one wire entry per exposure, in the list's own order.
 *
 * Rebuilt per call rather than kept as a constant, because it is derived and a constant would be the
 * place the derivation went stale. The cost is a handful of small objects.
 */
export function toModelTools(exposures: readonly LanguageExposure[]): readonly ModelTool[] {
  return exposures.map(toModelTool);
}

/**
 * One exposure as the wire shape, with the owner's name and description passed through untouched.
 *
 * The name is passed through for the same reason the description is, and it is the one field on this
 * wire that a provider constrains rather than a reader. OpenAI-compatible function calling accepts
 * `^[a-zA-Z0-9_-]+$` as `function.name` and answers anything else with a **400 on the entire request**,
 * so a dotted name here is not a capability a model declined to pick — it is a request that never
 * reached a model, and the caller sees a model that never spoke. Nothing can be checked here that the
 * owners have not already promised, so the constraint is asserted against the exposure lists in
 * `test/language.test.mjs`: the next owner to reach for a dot learns it from a failing test rather than
 * from a provider error at the far end of the client's reply timeout. The timeout is named rather than
 * quoted because it is derived from the longest exposure list — a literal here would go stale the next
 * time that list grows, which is exactly the drift this sentence is warning about.
 *
 * `parameters` is "an object with no properties" for a capability that takes nothing, which is the honest
 * schema for one. It is not a placeholder for a real schema to be filled in later: a capability that needs
 * one declares it, and `parametersFor` builds the wire shape from that declaration. A capability that
 * declares nothing gets the empty schema rather than an empty-but-permissive one, because the difference
 * between "takes no argument" and "takes any argument" is the difference this file exists to keep.
 */
function toModelTool(exposure: LanguageExposure): ModelTool {
  return Object.freeze({
    type: 'function' as const,
    function: Object.freeze({
      name: exposure.name,
      description: exposure.description,
      parameters: parametersFor(exposure),
    }),
  });
}

/**
 * The wire schema for one exposure: nothing, or the one string its owner declared.
 *
 * `required` is written out rather than left to `additionalProperties: false`, because the two say
 * different things — the first says the call must carry the argument, the second says it must not carry
 * anything else — and a model that omits `target` is a call this build refuses rather than one it reads
 * from somewhere else.
 */
function parametersFor(exposure: LanguageExposure): Readonly<Record<string, unknown>> {
  const argument = declaredArgument(exposure);
  if (argument === undefined) {
    return Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
      additionalProperties: false,
    });
  }
  return Object.freeze({
    type: 'object',
    properties: Object.freeze({
      [argument.name]: Object.freeze({ type: 'string', description: argument.description }),
    }),
    required: Object.freeze([argument.name]),
    additionalProperties: false,
  });
}

/**
 * What an exposure declares about its argument, if it declares one.
 *
 * The `in` check is what makes the union worth having: three of the five entries have no such field, and
 * after this narrows, the one that does is the only one whose `argument` can be read. A `exposure.argument`
 * without the check would not compile, which is the point — the alternative is a union with the field
 * declared optionally on every member, and then nothing would notice an owner that stopped declaring it.
 */
function declaredArgument(exposure: LanguageExposure): DeclaredArgument | undefined {
  return 'argument' in exposure ? exposure.argument : undefined;
}

/**
 * A call this build will perform: the entry it named, the values it carried, and what it *is*.
 *
 * The `key` is the call's identity, and it exists because a name stopped being enough the moment one
 * capability took an argument — two reads of two files are two calls, and the loop that suppresses
 * repeats has to be able to tell them apart without asking the model to. It is the exposure's name plus
 * the argument's value, joined by a NUL, which no path can contain; when there is no argument it is
 * simply the name, so every call that was identifiable before is identified the same way now.
 *
 * It is deliberately not carried on `GroundedBlock`: `express.ts` turns block names into a line a human
 * reads, and a key there would put a NUL-separated path in the middle of an answer.
 */
export interface ReadCall {
  readonly exposure: LanguageExposure;
  readonly values: Readonly<Record<string, string>>;
  readonly key: string;
}

/**
 * The call a model made, or `undefined` when it is not one this build will perform.
 *
 * Two ways a call fails to be a read, and they are deliberately one answer: a name that matches no
 * exposure, and arguments that are not what that exposure declares. A third case — a call already
 * performed in this interaction — is not visible from here, because it is a fact about the loop rather
 * than about the call; `answer.ts` holds the keys it has performed and declines those itself.
 *
 * Distinguishing the two failures would be building the error taxonomy the mandate forbids, for two cases
 * no human ever sees.
 */
export function readCall(
  call: ModelToolCall,
  exposures: readonly LanguageExposure[],
): ReadCall | undefined {
  const exposure = findExposure(call.name, exposures);
  if (exposure === undefined) return undefined;
  const reading = readArguments(call.arguments, declaredArgument(exposure));
  if (reading.kind === 'malformed') return undefined;
  if (reading.kind === 'none') {
    return Object.freeze({ exposure, values: NO_ARGUMENTS, key: exposure.name });
  }
  return Object.freeze({
    exposure,
    values: Object.freeze({ [reading.name]: reading.value }),
    key: `${exposure.name}\u0000${reading.value}`,
  });
}

const NO_ARGUMENTS: Readonly<Record<string, string>> = Object.freeze({});
