// The local endpoint a data directory's Repository CI relevance judgement owns, or `undefined` on a
// host without pipes.
//
// Derived from the data directory, not published into it, for the reason every endpoint in this
// repository is: a published address file answers "is there an endpoint?" with a remembered fact that
// can go stale, while a name the operating system owns is answered by connecting — either something
// is listening or the call fails with ENOENT, and ENOENT is the current truth rather than a cached
// opinion of one.
//
// That property carries more weight here than it does for the work focus. This endpoint exists only
// when the Repository CI capability was explicitly configured, so "nothing is listening" is the
// ordinary answer for a default Resident — and it has to be an answer a client can act on, not an
// error it has to interpret. See `src/cli/relevance.ts` for what the client does with it.
//
// Both ends call this same function, so they agree by construction. It is written out rather than
// imported from `src/cli/control.ts` or from the work focus's own module, and the reason is the same
// one given there: a domain plugin that reached into the Resident's composition root for a path helper
// would have taken a dependency on a command, permanently, to save twenty lines.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const PIPE_PREFIX = 'hikari-repository-ci-relevance-';
const HASH_LENGTH = 16;

export function relevanceEndpointPath(rootDir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const digest = createHash('sha256').update(canonicalRootDir(rootDir), 'utf8').digest('hex').slice(0, HASH_LENGTH);

  return `\\\\.\\pipe\\${PIPE_PREFIX}${digest}`;
}

function canonicalRootDir(rootDir: string): string {
  const canonical = readCanonicalPath(rootDir) ?? resolve(rootDir);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

// `realpathSync.native` is the filesystem's own answer, and it throws when the directory does not
// exist — which is an ordinary case here rather than an error, since a client may ask before anything
// has created the data directory. The lexical form stands in, and the two only meet because case is
// taken out of the comparison.
function readCanonicalPath(rootDir: string): string | undefined {
  try {
    return realpathSync.native(rootDir);
  } catch {
    return undefined;
  }
}
