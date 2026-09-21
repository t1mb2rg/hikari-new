// The current explicit work focus, and the three writes that move it.
//
// This file has no I/O, no endpoint, no lifecycle and no knowledge that a pipe exists. It is the
// whole of the domain: a set of designations a human stated, and what `declare` / `replace` / `clear`
// do to that set. Keeping it apart is what lets the transitions be read as what they are, rather than
// as branches inside a socket handler.
//
// What is deliberately *not* here is any interpretation of a designation. Nothing in this file asks
// whether a designation names a repository, a window, a directory or a person; nothing folds case,
// strips whitespace, takes a basename or guesses an owner/name pair. A designation is text a human
// wrote about their own work, and the only question this module is entitled to ask about it is
// whether it is there at all.

import type { WorkFocusRequest } from './types.js';

export interface WorkFocusState {
  /**
   * The designations as the human typed them, in no promised order.
   *
   * Order is not part of this contract. The implementation appends, so a status taken twice in a row
   * with no write between them reads the same, and that is all that is being offered: a caller that
   * relied on the sequence would be relying on something nobody has agreed to keep.
   */
  readonly designations: readonly string[];
}

export type WorkFocusTransition =
  | { readonly kind: 'ok'; readonly state: WorkFocusState }
  | { readonly kind: 'refused'; readonly reason: string };

export function emptyWorkFocus(): WorkFocusState {
  return Object.freeze({ designations: Object.freeze([]) as readonly string[] });
}

/**
 * The one legality rule this module has about a designation, and it is a predicate, not a transform.
 *
 * `trim()` appears here exactly once and its result is never stored. It answers "is there anything
 * here at all?" — and a designation that is empty or only whitespace is refused rather than
 * normalised, because storing `''` would mean Hikari holds a work focus that reads as no work focus.
 * The value that *is* accepted goes into the set byte for byte as it arrived.
 */
function readDesignation(value: string): string | undefined {
  return value.trim() ? value : undefined;
}

export function applyWorkFocusRequest(
  state: WorkFocusState,
  request: WorkFocusRequest,
): WorkFocusTransition {
  if (request.word === 'status') return { kind: 'ok', state };

  if (request.word === 'clear') return { kind: 'ok', state: emptyWorkFocus() };

  if (request.word === 'declare') {
    const designation = readDesignation(request.designation);
    if (designation === undefined) return refused('工作焦点不能是空白的。');

    // Declaring what is already declared is not an error and not a change. A set has no room for a
    // second copy of a member, so there is nothing to do and nothing to report; refusing would
    // invent a rule ("one declaration per designation") that no part of this capability needs.
    if (state.designations.includes(designation)) return { kind: 'ok', state };

    return { kind: 'ok', state: freeze([...state.designations, designation]) };
  }

  // `replace` needs at least one designation. The empty set is a state this module can hold, but it
  // has exactly one way in — `clear` — and a second spelling of it would be a second thing to keep
  // in step. A caller who wants nothing left says so with the word that means that.
  if (request.designations.length === 0) {
    return refused('replace 至少需要一个工作焦点；要清空请用 clear。');
  }

  const next: string[] = [];
  for (const raw of request.designations) {
    const designation = readDesignation(raw);
    if (designation === undefined) return refused('工作焦点不能是空白的。');
    // A set, so a repeat inside one request collapses exactly as a repeat across two requests does.
    if (!next.includes(designation)) next.push(designation);
  }

  return { kind: 'ok', state: freeze(next) };
}

const HEADER = '当前工作焦点：';
const NONE = '（当前没有任何工作焦点。）';

/**
 * What the current set is, as lines the human who asked can read.
 *
 * Every write answers with this too, and not with a claim about what it did. "已更新" would be a lie
 * for a `declare` of something already declared, and the human's actual question — after any of the
 * three writes — is the same question `status` asks. One renderer, so the answer cannot differ by
 * which command happened to print it.
 */
export function renderWorkFocus(state: WorkFocusState): readonly string[] {
  if (state.designations.length === 0) return [HEADER, NONE];
  return [HEADER, ...state.designations];
}

function freeze(designations: string[]): WorkFocusState {
  return Object.freeze({ designations: Object.freeze(designations) as readonly string[] });
}

function refused(reason: string): WorkFocusTransition {
  return { kind: 'refused', reason };
}
