// Finding text inside the set, and the whole of what one search does.
//
// This is the third question this module answers. The first two — what is in the set, and what is inside
// one of its directories — turned out to be unusable on their own: a real acceptance run on 2026-10-14
// spent six of its eight reads listing directories and guessing at file names, and the answer it was
// looking for sat in `history.ts`, a file in a directory it had already been shown. The run, the shape it
// forced, and the line of the read slice's freeze it reverses ("只有一个 `read`") are recorded in
// `changeable-repositories-search-v0-boundary-review.md`.
//
// Containment here is by construction rather than by judgement, and that is what this file is built
// around. The walk never follows a symbolic link — not "follows one and then checks where it landed",
// which would put the guarantee at the mercy of a check being right, but does not follow one at all.
// Every name it opens is therefore a canonical root plus directory entries inside it, so `read.ts`'s
// `within()` is not consulted: a name that was never resolved through a link cannot have left the set.
//
// The walk is synchronous, and the reason is a rule of this repository rather than a preference: there is
// no `node:fs/promises` import anywhere in `src/`, because the Chronicle's atomicity argument rests on
// there being no `await` between a check and the write that follows it. What makes a synchronous walk
// acceptable is arithmetic instead — four constants that bound the work, so the worst case is a few
// hundred milliseconds rather than "it depends", and the review's §5.2 does that sum rather than asserting
// it. Reaching any of the four stops the walk, and `read.ts` says so in the reply: a bound that were
// absorbed silently would turn "there is more" into "this is all there is", which is the one thing this
// module must never do.
//
// What is *not* here: the frame. Every fixed line of every reply this contract produces is written in
// `read.ts`, next to the reads whose results it frames, and this file returns only the judgement — which
// is the same split `read.ts`'s header describes, one method further along.
//
// The walk does not descend into two directory names, and says which of them it actually skipped rather
// than assuming both. Nothing else is hidden: build output is not skipped, because skipping it would be
// this capability deciding what a reader means by their own repository.

import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** How many matches one search returns. */
export const MAX_SEARCH_MATCHES = 50;

/** How many files one search opens and scans. */
export const MAX_SEARCH_FILES = 1000;

/** How many bytes one search reads in total. */
export const MAX_SEARCH_BYTES = 4 * 1024 * 1024;

/** How much of one matching line a search keeps. */
export const MAX_SEARCH_MATCH_TEXT = 200;

/**
 * The directory names no search descends into, in the order a reply names them.
 *
 * `.git` holds a repository's own bookkeeping and `node_modules` holds somebody else's code; neither can
 * be text a human is about to change. The repository's one other skip list
 * (`scripts/citation-report.mjs`) also drops `dist`, `bin` and `obj`, and this list deliberately does not:
 * those hold build output, and a search that hid them would be answering "where does this text occur"
 * with "where does it occur in the files I decided matter".
 */
export const SEARCH_SKIPPED_DIRECTORY_NAMES: readonly string[] = Object.freeze(['.git', 'node_modules']);

/** Which of the four bounds a search reached; the first one it reached, and only that one. */
export type SearchBound = 'matches' | 'files' | 'bytes';

/** One place the needle was found: a canonical absolute path, a line number, and that line. */
export interface RepositoryMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * What one search produced, in two words and the four facts behind them.
 *
 * `truncatedBy` is one optional word rather than two booleans, which is the shape
 * `desktop-content-read/types.ts` uses for the same reason: a single field cannot say "not truncated" and
 * "truncated by the file count" at once, and it names *which* bound was reached instead of leaving the
 * reader to work it out from a pair of flags that can disagree. Which of the two truncation sentences that
 * word produces is `read.ts`'s decision rather than this file's, because a word is the judgement and a
 * sentence is a rendering.
 *
 * `unreadable` is every path the walk could not look into — a root that is gone, a subdirectory it could
 * not list, a file that vanished between being listed and being opened. They are one list rather than
 * three because they are one fact from here: this search did not look there, and the reader is told so
 * instead of being left with a smaller answer that looks complete.
 *
 * `skippedDirectories` names the names from `SEARCH_SKIPPED_DIRECTORY_NAMES` that were actually met, in
 * that fixed order, so that a reply claims only what happened.
 */
export type RepositorySearch =
  | {
      readonly kind: 'searched';
      readonly needle: string;
      readonly matches: readonly RepositoryMatch[];
      readonly truncatedBy?: SearchBound;
      readonly skippedDirectories: readonly string[];
      readonly unreadable: readonly string[];
    }
  | { readonly kind: 'nothing-declared' };

/** What one walk carries: the needle, what it has found so far, and what it has spent. */
interface Walk {
  readonly needle: string;
  readonly matches: RepositoryMatch[];
  readonly skipped: Set<string>;
  readonly unreadable: string[];
  files: number;
  bytes: number;
  truncatedBy?: SearchBound;
}

/**
 * Search every declared root for one piece of text.
 *
 * The set is read at call time by the caller, which is what keeps a `declare` that arrives between two
 * questions visible to the second one — the same rule the two methods beside this one follow.
 */
export function searchWithin(roots: readonly string[], needle: string): RepositorySearch {
  if (roots.length === 0) {
    return Object.freeze({ kind: 'nothing-declared' });
  }

  const state: Walk = {
    needle,
    matches: [],
    skipped: new Set<string>(),
    unreadable: [],
    files: 0,
    bytes: 0,
  };

  for (const root of roots) {
    walk(root, state);
  }

  const truncatedBy = state.truncatedBy;
  return Object.freeze({
    kind: 'searched',
    needle,
    // One past the bound is kept while walking and dropped here, so the caller is never handed the match
    // that proved there were more.
    matches: Object.freeze(state.matches.slice(0, MAX_SEARCH_MATCHES)),
    ...(truncatedBy === undefined ? {} : { truncatedBy }),
    skippedDirectories: Object.freeze(
      SEARCH_SKIPPED_DIRECTORY_NAMES.filter((name) => state.skipped.has(name)),
    ),
    unreadable: Object.freeze(state.unreadable.slice()),
  });
}

function walk(directory: string, state: Walk): void {
  if (state.truncatedBy !== undefined) {
    return;
  }

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A root that is gone, a directory whose permissions changed, a name that is no longer a directory.
    // The search carries on: one unreadable corner of the set is not a reason to answer nothing.
    state.unreadable.push(directory);
    return;
  }

  for (const entry of entries) {
    if (state.truncatedBy !== undefined) {
      return;
    }

    // Not followed, not resolved, and not listed: a symbolic link is a name whose target this module has
    // no opinion about, and refusing to follow any of them is what makes "inside the set" a property of
    // how these names were built rather than of a check that has to be right every time.
    if (entry.isSymbolicLink()) {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SEARCH_SKIPPED_DIRECTORY_NAMES.includes(entry.name)) {
        state.skipped.add(entry.name);
        continue;
      }
      walk(path, state);
      continue;
    }

    // A device, a socket, a fifo: named, and not a thing that holds text.
    if (!entry.isFile()) {
      continue;
    }

    scan(path, state);
  }
}

/**
 * Scan one file, or establish that this walk is not going to.
 *
 * Both spend bounds are tested before the file is opened, and both are established by a file that was
 * *met* rather than by a count that could disagree with one: reaching either line means a candidate is in
 * hand and this call is not going to look inside it. That is the same construction as `read.ts` reading
 * one byte past its own cap — "there was more" is shown rather than assumed.
 */
function scan(path: string, state: Walk): void {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    state.unreadable.push(path);
    return;
  }

  if (state.files >= MAX_SEARCH_FILES) {
    state.truncatedBy = 'files';
    return;
  }

  if (state.bytes + size > MAX_SEARCH_BYTES) {
    state.truncatedBy = 'bytes';
    return;
  }

  state.files += 1;

  let bytes: Buffer;
  try {
    bytes = readWhole(path, size);
  } catch {
    state.unreadable.push(path);
    return;
  }

  state.bytes += bytes.length;

  // A NUL byte is the whole of the test, and it is the same heuristic `read.ts` applies to the one file it
  // was asked for: it cannot be fooled by an encoding this build never claims to understand, and the cost
  // of being wrong is a skipped file rather than a wrong line. A file skipped this way is not reported
  // separately, because it is not "we did not look" — it is "there is nothing here to read".
  if (bytes.includes(0)) {
    return;
  }

  const lines = bytes.toString('utf8').split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!text.includes(state.needle)) {
      continue;
    }

    state.matches.push(
      Object.freeze({
        path,
        line: index + 1,
        text: text.length > MAX_SEARCH_MATCH_TEXT ? text.slice(0, MAX_SEARCH_MATCH_TEXT) : text,
      }),
    );

    // One past the bound, kept only long enough to know there was more: filling the list exactly would
    // leave "are there others" unanswered, and answering it by looking would mean walking the whole set to
    // find out what this bound exists to avoid walking.
    if (state.matches.length > MAX_SEARCH_MATCHES) {
      state.truncatedBy = 'matches';
      return;
    }
  }
}

/**
 * Read one file whole, having already been told how long it is.
 *
 * The length comes from the `stat` above rather than from the read, so a file that grows while the walk is
 * running is read as it was when it was measured. The alternative — reading until the read says stop —
 * would make the spend unbounded, which is the one thing the four constants exist to prevent.
 */
function readWhole(path: string, size: number): Buffer {
  const handle = openSync(path, 'r');
  try {
    const buffer = Buffer.allocUnsafe(size);
    let filled = 0;
    while (filled < size) {
      const read = readSync(handle, buffer, filled, size - filled, filled);
      if (read === 0) {
        break;
      }
      filled += read;
    }
    return buffer.subarray(0, filled);
  } finally {
    closeSync(handle);
  }
}
