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
// The parameters object is the one place this file says something in its own words, and what it says is
// "nothing". Every capability in every variant of this build is a zero-argument read, and the schema
// below is the truthful description of that: an object that accepts no properties. A model that tries to
// send an argument therefore fails against the endpoint rather than against a validator of ours, which is the
// smaller thing to own — `readArguments` then re-checks it on the way back, since the wire is the wire
// and `additionalProperties: false` is a request rather than a guarantee.
//
// What is deliberately absent: JSON Schema generation from a per-capability input type, a
// `LanguageTool`-shaped descriptor that carries fields the wire does not have, a registry to look names
// up in, and any argument validation beyond the one rule below. There is no input type to generate from
// yet; the first capability that takes an argument is the one that gets to decide what that looks like,
// and inventing the shape now would be inventing it for a capability nobody has written.

import type { LanguageExposure } from './exposure.js';
import type { ModelTool, ModelToolCall } from './model.js';

/**
 * The rule for a call's arguments, as a closed set.
 *
 * `none` is the only value that lets a call proceed. The other two are separated because they are
 * different sentences to whoever reads the log, not because they are handled differently — both stop
 * the same way.
 */
export type ArgumentReading = 'none' | 'malformed';

/**
 * Read the `arguments` string an OpenAI-compatible endpoint returns for a tool call.
 *
 * The rule the mandate states is "no arguments", and that is a stricter thing than "these arguments
 * are valid": the empty string, whitespace, and `{}` all mean the model sent nothing, and anything else
 * means it sent something. It does not matter whether what it sent would have been legal for some
 * hypothetical capability with parameters — this build has none, so an object with a key in it is a
 * call asking for something that does not exist, and it is refused rather than ignored. Silently
 * dropping the arguments and performing the read anyway would answer a question the model did not ask.
 */
export function readArguments(raw: string): ArgumentReading {
  const text = raw.trim();
  if (text === '') return 'none';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'malformed';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'malformed';
  return Object.keys(parsed).length === 0 ? 'none' : 'malformed';
}

/**
 * Find the exposure a model named, or `undefined` when it named something this variant does not offer.
 *
 * The comparison is against the list it was handed rather than against a copy of the names or against
 * some larger set it could consult, so a name that is not offered to this model is not found and cannot
 * become found by anything other than the caller passing a longer list. Lookup is linear because the
 * list is three entries long at most and a map would be a second structure to keep in step with the
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
 * `parameters` says "an object with no properties", which is the honest schema for a read that takes
 * nothing. It is not a placeholder for a real schema to be filled in later — when a capability needs
 * one, this function grows a way to get it from that capability's owner, and until then a richer shape
 * here would be describing capabilities that do not exist.
 */
function toModelTool(exposure: LanguageExposure): ModelTool {
  return Object.freeze({
    type: 'function' as const,
    function: Object.freeze({
      name: exposure.name,
      description: exposure.description,
      parameters: Object.freeze({
        type: 'object',
        properties: Object.freeze({}),
        additionalProperties: false,
      }),
    }),
  });
}

/**
 * The exposure a call names, or `undefined` when the call is not one this build will perform.
 *
 * Three ways a call can fail to be a read, and they are deliberately one answer. A name that matches no
 * exposure, a name already read in this interaction, and a call carrying arguments are all "this is not
 * a read I am going to perform", and the loop above treats them identically: the call is answered on the
 * wire so the batch stays complete, and the interaction stops. Distinguishing them would be building the
 * error taxonomy the mandate forbids, for three cases no human ever sees.
 */
export function readCall(
  call: ModelToolCall,
  exposures: readonly LanguageExposure[],
): LanguageExposure | undefined {
  const exposure = findExposure(call.name, exposures);
  if (exposure === undefined) return undefined;
  if (readArguments(call.arguments) !== 'none') return undefined;
  return exposure;
}
