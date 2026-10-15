// The one question every path in this module is asked before it is touched: is this still inside the
// repository the human declared?
//
// The read half (`repository-ci-*`'s sibling, `changeable-repositories/read.ts`) answers the same
// question for reads, and it answers it the same way — by canonicalising and comparing prefixes rather
// than by inspecting the string. That is not redundant care: `../` is only the most obvious way out of
// a directory, and the two that a string check cannot see are a symlink pointing outside and, on
// Windows, a short name that names a different place than it spells. Both are resolved by asking the
// filesystem, so the filesystem is asked.
//
// The difference from the read half is in *when* the check runs. A read names something that exists,
// so its containment check has a real path in hand. A write names something that may not exist yet —
// `write_file` is the whole reason this module exists — so the check cannot simply canonicalise the
// target. What it does instead is canonicalise the deepest ancestor that *does* exist and append the
// rest, which is the same answer for a target that exists and a target that does not, and which is why
// this file has a loop in it rather than one call.
//
// Windows case sensitivity is the reason the comparison folds case: a declared root spelled with a
// capital drive letter and a real path spelled with a lower one name one directory, and a check that
// said otherwise would refuse work the human asked for. Folding case can only ever make this check
// *stricter* in the one direction that matters — a path that differs from the root by case alone is
// inside it — and never looser in the other, because the separator requirement below still stands.

import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** What the check decided, and — when it refused — the sentence to give the human or the model. */
export type ContainmentVerdict =
  | { readonly kind: 'inside'; readonly absolute: string; readonly canonical: string }
  | { readonly kind: 'outside'; readonly reason: string }
  | { readonly kind: 'unresolvable'; readonly reason: string };

/**
 * Judge one path against one root.
 *
 * A relative path is required rather than merely preferred. An absolute path inside the root would
 * pass the prefix check and still be the wrong thing to accept, because it would mean the caller
 * decided where the root is — the executor received `root` as a parameter precisely so it does not get
 * to answer that question. Refusing absolutes outright keeps the parameter meaningful.
 */
export function containTarget(root: string, target: string): ContainmentVerdict {
  if (target.trim() === '') return { kind: 'outside', reason: '路径是空的。' };
  if (isAbsolute(target)) {
    return { kind: 'outside', reason: `路径必须是相对的：${target} 是绝对路径。` };
  }

  const rootReal = realPathOf(root);
  if (rootReal === undefined) {
    return { kind: 'unresolvable', reason: `仓库根不存在或无法解析：${root}` };
  }

  const absolute = resolve(root, target);
  const resolved = canonicalizeAllowingMissing(absolute);
  if (resolved === undefined) {
    return { kind: 'unresolvable', reason: `路径无法解析到任何已存在的祖先：${target}` };
  }

  if (!isInside(rootReal, resolved)) {
    return { kind: 'outside', reason: `路径落在人类声明的仓库之外：${target}` };
  }

  return { kind: 'inside', absolute, canonical: resolved };
}

/**
 * Canonicalise a path that may not exist yet.
 *
 * Walks up until an ancestor resolves, then re-appends the part that did not exist. The re-appended
 * part is not canonicalised, and it does not have to be: it names a directory that does not exist, so
 * there is nothing there for a symlink to point through. What the check is protecting against is an
 * existing link *inside* the root that leads out of it, and that link is always in the resolved prefix.
 */
export function canonicalizeAllowingMissing(absolute: string): string | undefined {
  let current = absolute;
  const trailing: string[] = [];

  for (;;) {
    const real = realPathOf(current);
    if (real !== undefined) {
      return trailing.length === 0 ? real : join(real, ...trailing.reverse());
    }

    const parent = dirname(current);
    if (parent === current) return undefined;

    trailing.push(current.slice(parent.length).replace(/^[\\/]+/u, ''));
    current = parent;
  }
}

/** Whether `candidate` is `root` itself or below it, compared the way this platform compares paths. */
export function isInside(root: string, candidate: string): boolean {
  const foldedRoot = foldPath(root);
  const foldedCandidate = foldPath(candidate);
  if (foldedCandidate === foldedRoot) return true;
  return foldedCandidate.startsWith(foldedRoot.endsWith('/') ? foldedRoot : `${foldedRoot}/`);
}

/** `realpathSync` as an answer rather than as a throw: a path that is not there is a fact, not an error. */
export function realPathOf(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}

/**
 * Case and separators folded, nothing else.
 *
 * Deliberately not `normalize` from `node:path`: that would also collapse `a/b/../c` into `a/c`, which
 * is a *different* answer from the one the filesystem gives when `b` is a symlink. The path reaching
 * this function has already been through `realpathSync`, so the only remaining differences are the
 * spelling ones this function is for.
 */
export function foldPath(value: string): string {
  return value.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();
}
