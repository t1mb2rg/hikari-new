// Which local directory a named repository is, according to the human's declaration and nothing else.
//
// `authorized-repository-action-v0-boundary-review.md` §3.1 took A2: the set of repositories Hikari may
// change is a separate, explicit declaration a human writes, and it is not the work focus. §4 then makes
// the second start condition "the mandate names a repository in that declared set". This file is where
// that condition is actually decided, and the way it is decided is the whole of its design: the set is
// read from the read half's `roots()`, each root is asked what GitHub repository it is *by git*, and the
// answer either matches the human's string or the run does not start.
//
// Three things this file refuses to do, each because doing it would move the decision somewhere it does
// not belong:
//
//   · It will not fold case. GitHub treats `Owner/Name` and `owner/name` as one repository; this build
//     compares the strings it was given, literally. A declaration is a human's spelling, and a matcher
//     that "helpfully" accepts other spellings is a matcher whose answer the human cannot predict by
//     reading what they wrote. A false refusal is visible and cheap; a false acceptance is the thing
//     the whole slice is arranged to prevent.
//   · It will not guess at a remote that is not GitHub. A clone of an internal mirror, a bare path, an
//     `origin` that points at a file — none of those are evidence about a GitHub repository, and this
//     file answers "not declared" rather than pattern-matching its way to a name.
//   · It will not fall back to "the only root there is". A declaration with one member is still a
//     declaration, and a rule that accepted the sole root for any name would accept every name.
//
// What it does not decide is whether the directory is a usable repository: that is `isRepositoryRoot`
// in `git.ts`, asked afterwards, so that "you never declared this" and "you declared something broken"
// stay two different sentences.

import { isRepositoryRoot, readOriginUrl, type GitBudgets } from './git.js';

/** What the declaration resolves a named repository to. */
export type ScopeResolution =
  | { readonly kind: 'declared'; readonly root: string }
  | { readonly kind: 'not-declared'; readonly reason: string };

/**
 * Look for the repository among the declared roots, asking git what each root is.
 *
 * Sequential rather than concurrent, deliberately: a declaration is a handful of directories, and a
 * spawn per root in parallel would be this build creating load it was never asked to create, on a
 * request a human is waiting for. The first root that names the repository wins, which is also the
 * order the human wrote — a rule that can be read off the declaration rather than one this file
 * invented.
 */
export async function resolveDeclaredRoot(
  repository: string,
  roots: readonly string[],
  budgets?: GitBudgets,
  signal?: AbortSignal,
): Promise<ScopeResolution> {
  if (roots.length === 0) {
    return {
      kind: 'not-declared',
      reason: '人类还没有声明任何可改仓库。先运行：hikari change declare <本机路径>',
    };
  }

  const seen: string[] = [];

  for (const root of roots) {
    if (!(await isRepositoryRoot(root, budgets, signal))) {
      seen.push(`${root}（不是 git 工作区的根）`);
      continue;
    }

    const url = await readOriginUrl(root, budgets, signal);
    const named = url === undefined ? undefined : repositoryNameFromUrl(url);

    if (named === undefined) {
      seen.push(`${root}（origin 不是 GitHub 上的 <owner>/<name>）`);
      continue;
    }
    if (named === repository) return { kind: 'declared', root };

    seen.push(`${root}（origin 是 ${named}）`);
  }

  return {
    kind: 'not-declared',
    reason: `${repository} 不在人类声明的可改仓库里。声明过的本机路径：${seen.join('；')}`,
  };
}

/**
 * The `owner/name` a git remote URL names, or `undefined` when it names no GitHub repository.
 *
 * Four spellings are recognised because they are the four a clone produces: the two HTTPS forms with
 * and without the `.git` suffix, and the two SSH forms git writes as `git@host:path` and
 * `ssh://git@host/path`. Anything else — another host, a relative path, a `file://` URL, a bare
 * directory — is not a GitHub repository, and the answer to "which one is it" is then that there is no
 * answer, which is what `undefined` means here.
 *
 * The name is returned as git spells it. Case is not touched, and neither is a trailing `.git`, which
 * is a suffix of the URL rather than part of the repository's name.
 */
export function repositoryNameFromUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === '') return undefined;

  const scp = /^[A-Za-z0-9._-]+@github\.com:(?<path>.+)$/u.exec(trimmed);
  const path = scp?.groups?.['path'] ?? pathOfGitHubUrl(trimmed);
  if (path === undefined) return undefined;

  const cleaned = path.replace(/\/+$/u, '').replace(/\.git$/u, '');
  const parts = cleaned.split('/').filter((part) => part !== '');
  if (parts.length !== 2) return undefined;
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return undefined;

  return `${parts[0]}/${parts[1]}`;
}

/** The path part of an `https://`, `http://` or `ssh://` URL whose host is exactly `github.com`. */
function pathOfGitHubUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.hostname.toLowerCase() !== 'github.com') return undefined;
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:' && parsed.protocol !== 'ssh:') {
    return undefined;
  }

  return parsed.pathname;
}
