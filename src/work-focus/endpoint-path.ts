// The local endpoint a data directory's work focus owns, or `undefined` on a host without pipes.
//
// The name is derived rather than published, for the same reason the Resident's control endpoint is:
// a published address file answers "is there an endpoint?" with a remembered fact that can go stale,
// while a derived name is answered by the operating system — connecting either finds a live endpoint
// or fails with ENOENT, and ENOENT is not a cached opinion, it is the current truth.
//
// Both ends call this same function, so they agree by construction. The CLI reaches it through this
// module's public entry point rather than re-deriving it, which is what keeps a client and a server
// from drifting apart the day someone changes the hash.
//
// The canonicalisation below is written out rather than imported from `src/cli/control.ts`, and the
// reason is not that the two disagree — they must not, or a data directory's two endpoints would be
// named by two different rules. It is that importing it would make a domain plugin depend on the
// Resident's composition root. A plugin that reaches into `src/cli/` for a path helper has taken a
// dependency on a command; the helper is twenty lines and the dependency is permanent.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const PIPE_PREFIX = 'hikari-work-focus-';
const HASH_LENGTH = 16;

export function workFocusEndpointPath(rootDir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const digest = createHash('sha256').update(canonicalRootDir(rootDir), 'utf8').digest('hex').slice(0, HASH_LENGTH);

  return `\\\\.\\pipe\\${PIPE_PREFIX}${digest}`;
}

function canonicalRootDir(rootDir: string): string {
  const canonical = readCanonicalPath(rootDir) ?? resolve(rootDir);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

// `realpathSync.native` is the filesystem's own answer: the on-disk spelling of every segment, one
// separator form, no trailing separator. It throws when the path does not exist, and a data directory
// that does not exist is an ordinary case — it is exactly what `hikari init` has not created yet — so
// the lexical form stands in rather than turning that into an error this module has no business
// raising. `realpath` returns the on-disk spelling when the directory exists and the lexical fallback
// is what runs when it does not, and the two only meet if case is taken out of the comparison.
function readCanonicalPath(rootDir: string): string | undefined {
  try {
    return realpathSync.native(rootDir);
  } catch {
    return undefined;
  }
}
