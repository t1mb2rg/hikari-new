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
// The third entry is the first capability here whose *verb* had to be declared rather than inferred, and
// the reason is the argument shape above rather than anything to do with searching. Two entries now
// declare one named string, so "does it declare an argument" no longer says which method is meant. A
// second argument shape was not the answer — the shape is what `tools.ts` decided, and this module does
// not get to decide it a second time — so the entry carries one word naming its method. The alternative,
// telling the two apart in `language/read.ts` by comparing exposure names, would move the owner's own
// statement about its capability into a string the consumer matches on, which is the trade that file's
// header refuses by name.
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

/**
 * Where one piece of text appears in the set.
 *
 * This is the third capability on one Service, and it is the first that has to say *which* of that
 * Service's methods it names. The first two are told apart without a word for it — `language/read.ts`
 * asks whether the exposure declares an argument at all — and that question stops being enough the moment
 * two capabilities answer it the same way, which is exactly what this one does with
 * `authorized_repository_read`: one takes a path, this one takes text to look for, and both declare one
 * named string. So the declaration grows one word, and it is this owner's word rather than the consumer's:
 * a capability that changed which method it names would change this module, not a dispatch written
 * somewhere else.
 *
 * The bounds behind the answer — how many matches, how many files, how much text — are deliberately not
 * in this description. They are in the reply when they matter, in the sentence that says the answer is
 * shorter than the question deserved, and a number in a description would be a promise this module has to
 * keep in two places.
 */
export interface AuthorizedRepositorySearchExposure {
  readonly name: string;
  readonly description: string;
  readonly method: 'search';
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

export const authorizedRepositorySearchExposure: AuthorizedRepositorySearchExposure = Object.freeze({
  name: 'authorized_repositories_search',
  description:
    '在已声明为可改的仓库目录里按内容找一段文字，返回出现它的文件、行号，以及那一行。原样匹配，区分大小写。',
  method: 'search',
  argument: Object.freeze({
    name: 'needle',
    description: '要找的一段文字。原样匹配，区分大小写；不接受正则或通配符。',
  }),
  service: changeableRepositoriesReadService,
});
