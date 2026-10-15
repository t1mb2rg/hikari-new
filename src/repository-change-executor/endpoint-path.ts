// The local endpoint a data directory's executor owns, or `undefined` on a host without pipes.
//
// The name is derived rather than published, for the reason every other local endpoint in this repository
// states: a published address file answers "is there an endpoint?" with a remembered fact that can go
// stale, while a derived name is answered by the operating system — connecting either finds a live
// endpoint or fails with ENOENT, and ENOENT is not a cached opinion.
//
// Both ends call this same function, so they agree by construction. The prefix differs from
// `hikari-changeable-repositories-` because the two endpoints answer different questions — what may be
// changed, and changing it — and a name that collided would make one of them unreachable rather than
// ambiguous. `realpathSync.native` is used for the same reason the sibling uses it: it is the
// filesystem's own answer to what the directory is called, including on a Windows volume where the same
// directory also has an 8.3 spelling.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const PIPE_PREFIX = 'hikari-repository-change-';
const HASH_LENGTH = 16;

export function repositoryChangeEndpointPath(rootDir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const digest = createHash('sha256')
    .update(canonicalRootDir(rootDir), 'utf8')
    .digest('hex')
    .slice(0, HASH_LENGTH);

  return `\\\\.\\pipe\\${PIPE_PREFIX}${digest}`;
}

function canonicalRootDir(rootDir: string): string {
  const canonical = readCanonicalPath(rootDir) ?? resolve(rootDir);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

// It throws when the path does not exist, and a data directory that does not exist is an ordinary case —
// it is exactly what `hikari init` has not created yet — so the lexical form stands in rather than
// turning that into an error this module has no business raising.
function readCanonicalPath(rootDir: string): string | undefined {
  try {
    return realpathSync.native(rootDir);
  } catch {
    return undefined;
  }
}
