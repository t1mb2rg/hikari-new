// What this plugin offers an intelligence layer, and which of its contracts the offer is a view of.
//
// The same shape and the same reasons as `work-focus/exposure.ts` and `desktop-session-awareness/exposure.ts`:
// a capability is the view formed from a public Service (`core-architecture-v0.md` §5.3), so this is two
// strings and a pointer at a contract that already exists, exported beside it by the owner of the
// semantics. Nothing is copied, nothing is registered, and `service` is the same frozen contract object
// `contracts.ts` exports, so "this exposure is a view of that Service" is a claim a test proves by
// identity rather than one a reader has to trust.
//
// The owner is this plugin, not the layer that consumes it, and the split is `principles.md` §6's: the
// provider owns the "how" and the semantics with it, the consumer owns the question of what to do with
// the result — including *which* capabilities are offered. A consumer that wrote these words would be a
// second thing deciding what this domain's capability is called, and the day the two disagree the
// disagreeing is invisible, because a description is prose and prose has no compiler.
//
// The description carries what the capability does *not* mean, and that is the load-bearing half here.
// `relevant` asserts one thing and one only — a string a human declared and a string a CI observation
// reported are the same characters — and every step from there is available to a reader of the two
// strings without being established by them: that the repository matters, that the CI state is good or
// bad, that anyone should act, or that the human's declaration was about this repository in any sense.
// `unknown` is the other half and is just as easy to overread. It says a judgement completed and no such
// equality was found; it is not a failure, not "unrelated", and not evidence the two have nothing to do
// with each other. A capability that let a model take any of those steps would be handing it conclusions
// this plugin never drew — and this plugin is the only thing in Hikari that ever draws this one.
//
// `repository_ci_relevance_read` rather than a second word for a judgement that already has an endpoint:
// the name is agent-facing vocabulary and deliberately not a contract id, for the wire reason both other
// exposures record — OpenAI-compatible function calling requires `^[a-zA-Z0-9_-]+$` on
// `tools[*].function.name`, and a dotted name is answered with a 400 on the entire request rather than
// being declined by a model.
//
// Deliberately absent, for the reason `work-focus/exposure.ts` records at length: no input schema, no
// output schema, no authority or side-effect classification, no tags, categories, cost, hints, examples,
// aliases or discovery keywords. A read capability that takes no arguments needs none of them, and the
// field added for a caller that does not exist yet is the "maybe somebody will want it" §16 refuses.

import type { ServiceContract } from '../runtime/contracts.js';

import {
  repositoryCiRelevanceService,
  type RepositoryCiRelevanceService,
} from './contracts.js';

/**
 * What an intelligence layer is offered, and what it is offered about.
 *
 * Three fields, and the third is what keeps the first two honest: a name and a description with nothing
 * underneath them would be a label a consumer could attach to whichever Service it preferred.
 */
export interface RepositoryCiRelevanceReadExposure {
  /**
   * The stable name a model selects this by. Agent-facing vocabulary, deliberately not a contract id.
   *
   * It is also the string that goes on the wire as `tools[*].function.name`, and that wire constrains it
   * rather than this repo: OpenAI-compatible function calling requires `^[a-zA-Z0-9_-]+$`. A contract id
   * such as `repository-ci-relevance.current@1` is legal here and a dotted name is not — the provider
   * answers a malformed name with a 400 on the request, which reaches the caller as a model that never
   * spoke rather than as a capability a model declined to pick. The two vocabularies are separate on
   * purpose: this one is chosen to survive the wire, the contract id is chosen to be a stable identity.
   */
  readonly name: string;
  /** What the capability covers and, just as load-bearingly, what it does not. */
  readonly description: string;
  /** The public Service this is a view of. */
  readonly service: ServiceContract<RepositoryCiRelevanceService>;
}

/**
 * The Repository CI relevance judgement, as an intelligence layer may ask for it.
 *
 * The description is the whole of what a future model is told about this capability, so it carries the
 * limit as well as the offer. What a caller gets through this name is a comparison of two strings and
 * the word for its outcome — never the snapshot, the designations, or any step this plugin did not take.
 */
export const repositoryCiRelevanceReadExposure: RepositoryCiRelevanceReadExposure = Object.freeze({
  name: 'repository_ci_relevance_read',
  description:
    '读取 Hikari 已经建立的 Repository CI relevance 判定。结果只是这个判定本身：用户显式声明过的某个 designation 与 GitHub CI observation 报告的 repository 字符串是否逐字相同。relevant 只表示这两串字符相同，不表示这个 repository 重要、不表示 CI 状态好坏、不表示应该有谁采取行动；unknown 只表示判定已经完成而没有建立这种逐字相等关系，不表示失败、不表示无关，也不表示两者之间没有关系。',
  service: repositoryCiRelevanceService,
});
