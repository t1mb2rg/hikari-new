// The Repository CI diagnosis proposal, as a plugin.
//
// What it owns: whether a specific follow-up is worth suggesting for one failure that has already been
// judged relevant. What it does not own: what CI is (`github-ci`), whether a repository is the one the
// human meant (`repository-ci-relevance`), whether two commit strings match
// (`repository-ci-awareness`), when to look (`repository-ci-attention`), whether this was said before
// (same), how it is worded (`language`), whether anyone is listening (`human-delivery`), or what a
// durable fact is (`chronicle`).
//
// It has one requirement and it is not an acquisition: relevance, asked about the snapshot the caller
// handed in. The rest of its material arrives as an argument, and that is deliberate — this module must
// not read the world in the same cycle that Attention already read it, or the failing run and the thing
// it was compared against could come from two different moments and no one would be able to tell.
//
// `provides` is non-empty and that is not cosmetic. This module is not a decider that only ever speaks;
// it is a thing another module asks, and the contract is what makes that relationship explicit and
// refusable. It holds no state, has no cadence, no timer, no dedupe set and no history of its own: every
// answer is computed from the request and the human's current focus, and two calls a second apart are two
// answers rather than two steps of a sequence.
//
// Zero configuration, on purpose. The policy is written in `judgement.ts`. A rule language a human could
// declare would be a much larger thing — a semantic owner, storage, a lifecycle, conflict rules and a
// question about which consumers may read it — and none of that is justified by "there is one suggestion
// worth making about a red CI run". It is added when a real need makes it necessary, not so that this
// plugin can look configurable.

import type { PluginDefinition } from '../runtime/plugin.js';
import { repositoryCiRelevanceJudgeService } from '../repository-ci-relevance/index.js';

import { repositoryCiDiagnosisProposalService } from './contracts.js';
import { judgeProposal } from './judgement.js';
import type { RepositoryCiDiagnosisProposal, RepositoryCiDiagnosisRequest } from './types.js';

export const repositoryCiDiagnosisProposalPlugin: PluginDefinition = {
  id: 'repository-ci-diagnosis-proposal',
  version: '1.0.0',
  requires: [repositoryCiRelevanceJudgeService],
  provides: [repositoryCiDiagnosisProposalService],
  setup(context) {
    const relevance = context.services.get(repositoryCiRelevanceJudgeService);

    // A named function with its own signature rather than an inline method, for the reason every other
    // provider in this repository is written that way: the contract's type has to reach the parameter,
    // and an inline method inside `Object.freeze` does not give the compiler the context to check it.
    async function propose(request: RepositoryCiDiagnosisRequest): Promise<RepositoryCiDiagnosisProposal> {
      // The relevance judgement is made here, from the snapshot the caller supplied, rather than
      // being handed in as a value. Both shapes would work; this one keeps the caller from having to
      // know that a relevance judgement is what a suggestion is made of, and keeps the judgement
      // and the suggestion in one call so they cannot describe two different snapshots.
      const judgement = await relevance.judge(request.assessment.snapshot);

      return judgeProposal({
        occurrence: request.occurrence,
        assessment: request.assessment,
        relevance: judgement,
      });
    }

    context.services.provide(repositoryCiDiagnosisProposalService, Object.freeze({ propose }));
  },
};
