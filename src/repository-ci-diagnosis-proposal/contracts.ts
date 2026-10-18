// The diagnosis question, as a contract with the rest of Hikari.
//
// This Service has a caller on the day it lands, and that is the point rather than a coincidence. The
// module it belongs to was designed the other way round from the draft that preceded it: not a second
// proactive plugin that polls, dedupes, delivers and writes its own receipts, but a **domain answer to a
// question the one existing proactive plugin asks before it speaks**. So the first consumer is
// `repository-ci-attention`, which already has what this needs — the failure it is about to announce and
// the one assessment its cycle acquired — and which is the only thing here that decides when to look.
//
// What it exposes is the answer and the whole of it: a `RepositoryCiDiagnosisProposal`, which is either
// one of two suggestions with the facts behind it, or the statement that there is no suggestion. It does
// not expose the relevance judgement, the snapshot or the comparison as separate calls, because a caller
// that could ask for those separately would be assembling the judgement itself.
//
// Nothing is held between calls. There is no cache, no last answer and no history: the proposal is a
// function of the material handed in, and a caller that asks twice with the same material gets the same
// answer because nothing happened in between.

import { defineService } from '../runtime/contracts.js';

import type { RepositoryCiDiagnosisSupplementRequest } from './supplement.js';
import type { RepositoryCiDiagnosisProposal, RepositoryCiDiagnosisRequest } from './types.js';

export interface RepositoryCiDiagnosisProposalService {
  /**
   * The suggestion for this failure, or the statement that there is none.
   *
   * `async` because the relevance judgement it consults is async — it pulls the human's current work
   * focus on every call. This does **not** acquire a world snapshot: the assessment comes in with the
   * request, which is what keeps one cycle to one acquirement.
   *
   * It never resolves a failure into `insufficient-evidence`. A dependency that rejects makes this
   * reject: `insufficient-evidence` is an answer this layer reached from material it had, and a failed
   * acquisition is a question it did not get to put. A caller that wants those told apart gets them
   * told apart.
   */
  propose(request: RepositoryCiDiagnosisRequest): Promise<RepositoryCiDiagnosisProposal>;
}

export const repositoryCiDiagnosisProposalService = defineService<RepositoryCiDiagnosisProposalService>(
  'repository-ci-diagnosis-proposal.propose',
  1,
);

/**
 * The model-written supplement, as a second question this package answers.
 *
 * A separate Service rather than a field on the proposal, and the separation is the contract: the
 * proposal is a deterministic answer that exists whether or not an operator configured a model, and the
 * supplement is an addition that can be absent for a dozen reasons that are all normal. A caller holding
 * only one call could not tell "the judgement had nothing to say" from "no model was configured", and
 * that difference is what decides whether a notification goes out unchanged or not at all.
 *
 * `attach` returning a string is the one place this package hands over words. They are not a suggestion:
 * they are labelled model content, and the label travels inside the returned block so that a caller
 * cannot append the text without it.
 */
export interface RepositoryCiDiagnosisSupplementService {
  attach(request: RepositoryCiDiagnosisSupplementRequest): Promise<string | undefined>;
}

export const repositoryCiDiagnosisSupplementService =
  defineService<RepositoryCiDiagnosisSupplementService>('repository-ci-diagnosis-proposal.supplement', 1);
