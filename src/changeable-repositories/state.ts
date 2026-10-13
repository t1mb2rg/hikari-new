// The directories Hikari is authorized to change, and the three writes that move that set.
//
// This file has no I/O, no endpoint, no lifecycle and no knowledge that a pipe exists. It is the whole
// of the domain: a set of directories a human named, and what `declare` / `replace` / `clear` do to
// it. Keeping it apart is what lets the transitions be read as what they are, rather than as branches
// inside a socket handler.
//
// What is deliberately *not* here is any judgement about the directories. This module does not ask
// whether a directory holds a repository, whether it is inside another member, whether one member
// shadows another, or what a member might authorize later. A member is a directory the human named,
// and the only questions this file is entitled to ask are the two `paths.ts` answers: is it a path at
// all that could name the same thing twice, and is it there.
//
// What *is* here, and would not be in a plugin whose members are never compared, is that a member is
// admitted in its canonical form. That is `paths.ts`'s rule, applied at the one moment it can be
// applied once: the set is well-formed by construction, so every later reader — including the check
// that has not been built yet — compares canonical to canonical and never has to resolve anything.

import type { DirectoryReader, PathReading } from './paths.js';
import type { ChangeableRepositoriesRequest } from './types.js';

export interface ChangeableRepositoriesState {
  /**
   * The authorized directories, canonical and absolute, in no promised order.
   *
   * Order is not part of this contract, for the same reason it is not part of the work focus's: the
   * implementation appends, so a `status` taken twice with no write between them reads the same, and
   * that is all that is being offered.
   */
  readonly repositories: readonly string[];
}

export type ChangeableRepositoriesTransition =
  | { readonly kind: 'ok'; readonly state: ChangeableRepositoriesState }
  | { readonly kind: 'refused'; readonly reason: string };

export function emptyChangeableRepositories(): ChangeableRepositoriesState {
  return Object.freeze({ repositories: Object.freeze([]) as readonly string[] });
}

/**
 * The three writes, and `status`, which moves nothing.
 *
 * The reader arrives as an argument rather than being imported, which is the whole reason this
 * function can be asserted without a disk. It is also why the refusals below are built from what the
 * reading *was* rather than from a caught exception: this file never learns that a filesystem exists,
 * so it cannot accidentally grow a second opinion about one.
 */
export function applyChangeableRepositoriesRequest(
  state: ChangeableRepositoriesState,
  request: ChangeableRepositoriesRequest,
  reader: DirectoryReader,
): ChangeableRepositoriesTransition {
  if (request.word === 'status') return { kind: 'ok', state };

  if (request.word === 'clear') return { kind: 'ok', state: emptyChangeableRepositories() };

  // `replace` needs at least one directory. The empty set is a state this module can hold, but it has
  // exactly one way in — `clear` — and a second spelling of it would be a second thing to keep in
  // step. A caller who wants nothing left says so with the word that means that.
  //
  // `declare` with nothing to declare is *not* refused the same way: it names no directory that could
  // be wrong, so it is simply a request that cannot move the set, and it answers like any other no-op.
  // The difference is the same one the sibling plugin draws — an act that names nothing is a mistake
  // when the word required a name, and a no-op when it did not.
  if (request.word === 'replace' && request.repositories.length === 0) {
    return refused('replace 至少需要一个目录；要清空请用 clear。');
  }

  const next: string[] = request.word === 'declare' ? [...state.repositories] : [];
  for (const raw of request.repositories) {
    const reading = reader.read(raw);
    if (reading.kind !== 'ok') return refused(refusalFor(reading, raw));
    // A set, so a repeat inside one request collapses exactly as a repeat across two requests does —
    // and because both sides are canonical, two spellings of one directory collapse as one member.
    if (!next.includes(reading.canonical)) next.push(reading.canonical);
  }

  return { kind: 'ok', state: freeze(next) };
}

/**
 * Whether two states hold the same members.
 *
 * This is the whole of the state-equivalence question here, and it is deliberately not a general one.
 * `repositories` never holds a duplicate, so comparing lengths and then containment is exact rather
 * than approximate and neither side has to be sorted first.
 *
 * It is a claim about the set, not about the representation: order is not part of this contract, so
 * two states that differ only in the order they were written are the same state, and because nothing
 * here looks at object identity, a `replace` that rebuilt an equal array is equal.
 *
 * The caller is the session, asking whether a request moved anything. That question decides whether
 * there is an occurrence to admit, so the answer has to be about the domain rather than about whether
 * some function happened to allocate.
 */
export function sameMembership(
  before: ChangeableRepositoriesState,
  after: ChangeableRepositoriesState,
): boolean {
  const left = before.repositories;
  const right = after.repositories;
  return left.length === right.length && left.every((repository) => right.includes(repository));
}

// The two sentences the human is told when a directory cannot be admitted, and they are kept apart
// because the fix differs: one is a typo in how the path was written, the other is a path that is not
// a directory. Both quote the path *as it arrived* — the canonical form does not exist in the failing
// case, and echoing a resolved form back would be showing the human something they did not type.
const NOT_ABSOLUTE = (value: string): string => `${value} 不是一个绝对路径。`;
const NOT_A_DIRECTORY = (value: string): string => `${value} 不是一个存在的目录。`;

function refusalFor(reading: PathReading, raw: string): string {
  return reading.kind === 'not-absolute' ? NOT_ABSOLUTE(raw) : NOT_A_DIRECTORY(raw);
}

// What an empty set reads as. There is no header line above the members when there are members: the
// set is the answer, and a heading would be decoration on a list of paths that are already the whole
// of it. The empty case is the one that needs a sentence, because no lines at all would be
// indistinguishable from a surface that failed.
const NONE = '这个数据目录里还没有授权任何可改仓库。';

/**
 * What the current set is, as lines the human who asked can read.
 *
 * Every write answers with this too, and not with a claim about what it did. "已更新" would be a lie
 * for a `declare` of something already declared, and the human's actual question — after any of the
 * three writes — is the same question `status` asks. One renderer, so the answer cannot differ by
 * which command happened to print it.
 */
export function renderChangeableRepositories(
  state: ChangeableRepositoriesState,
): readonly string[] {
  if (state.repositories.length === 0) return [NONE];
  return [...state.repositories];
}

function freeze(repositories: string[]): ChangeableRepositoriesState {
  return Object.freeze({ repositories: Object.freeze(repositories) as readonly string[] });
}

function refused(reason: string): ChangeableRepositoriesTransition {
  return { kind: 'refused', reason };
}
