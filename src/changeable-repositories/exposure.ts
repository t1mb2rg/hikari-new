// What this module offers a model, as opposed to what it offers its own CLI.
//
// The declaration half has a client — the human who names a directory reaches this plugin over its own
// pipe — and this is the second audience: the model, reached through Language. The two are kept apart
// rather than merged because they are answers to different questions. A client is told what happened to
// the set; a model is offered a capability it can decide to use, and the words below are the whole of
// what it is told about it.
//
// Each entry is this owner's own statement of what reading this domain means, exported here so that
// Language can list it *by reference*. Language's `exposure.ts` explains why that direction matters —
// a consumer that restated an owner's description in its own words would be a second thing deciding what
// this domain's capability covers — and the consequence for this file is that the descriptions are not
// written for a model to be *steered* by. They say what the capability returns and, in the first one,
// what it does not claim.
//
// The second entry is the first capability in this build that takes an argument, and `tools.ts` records
// that the first one is the one that decides what an argument looks like. What it decided, here, is one
// named string and nothing else: no object, no array, no optional second field, no default. An exposure
// that does not declare an argument keeps the zero-argument shape it has always had, which is what keeps
// the three existing capabilities from growing a field none of them can use — `work-focus/exposure.ts`
// refuses that field by name, and re-deciding that refusal for a capability that needs it would be a
// worse trade than adding an optional one that only this entry carries.
//
// The frame a model actually reads is not here. It is in `read.ts`, next to the read that produces the
// judgement, because a description is what a capability *is* and a frame is what one *answer* looks
// like — and because the closing line of that frame has to travel with every reply rather than being
// reconstructed from a description each time.

import type { ServiceContract } from '../runtime/contracts.js';

import type { ChangeableRepositoriesReadService } from './read.js';
import { changeableRepositoriesReadService } from './read.js';

/** The set itself: what a human has declared, with no interpretation attached. */
export interface AuthorizedRepositoriesListExposure {
  readonly name: string;
  readonly description: string;
  readonly service: ServiceContract<ChangeableRepositoriesReadService>;
}

/**
 * One path inside the set: a file's text, or a directory's direct entries.
 *
 * The argument is declared rather than implied, and it is declared as a *shape* — a name and a
 * description — rather than as a JSON Schema fragment. A schema written here would be this module
 * claiming to know what the model's tool list looks like, and `tools.ts` already owns that translation
 * for the three capabilities that need no translation at all.
 */
export interface AuthorizedRepositoryReadExposure {
  readonly name: string;
  readonly description: string;
  readonly argument: { readonly name: string; readonly description: string };
  readonly service: ServiceContract<ChangeableRepositoriesReadService>;
}

export const authorizedRepositoriesListExposure: AuthorizedRepositoriesListExposure = Object.freeze({
  name: 'authorized_repositories_list',
  description:
    '列出用户明确声明为可改的代码仓库目录。结果只是那组目录本身，不解释为什么被声明，也不代表它们现在可以被动。',
  service: changeableRepositoriesReadService,
});

export const authorizedRepositoryReadExposure: AuthorizedRepositoryReadExposure = Object.freeze({
  name: 'authorized_repository_read',
  description:
    '读取一个已授权仓库里的内容：给一个文件路径就返回它的文本，给一个目录路径就返回它直接包含的项，两者都以绝对路径给出。',
  argument: Object.freeze({
    name: 'target',
    description: '要读的路径。绝对路径；必须在已声明的目录之内。',
  }),
  service: changeableRepositoriesReadService,
});
