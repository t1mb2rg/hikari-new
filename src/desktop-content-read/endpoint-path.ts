// The local endpoint a data directory's content read owns, or `undefined` on a host without pipes.
//
// Derived from the data directory, not published into it, for the reason every endpoint in this
// repository is derived: a published address file answers "is there an endpoint?" with a remembered
// fact that can go stale, while a name the operating system owns is answered by connecting — either
// something is listening or the call fails with ENOENT, and ENOENT is the current truth rather than a
// cached opinion of one.
//
// Same shape as the desktop session observation's, and a different name, because they are two
// endpoints with two different answers and a client must not be able to reach one while asking for the
// other. Both ends call this same function, so they agree by construction.
//
// Written out rather than imported from the sibling module for the reason given there and again in
// `protocol.ts`: importing it would make one domain module depend on another's endpoint naming to save
// twenty lines, and the two names are the only thing they share.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const PIPE_PREFIX = 'hikari-desktop-content-read-';
const HASH_LENGTH = 16;

export function contentReadEndpointPath(rootDir: string): string | undefined {
  if (process.platform !== 'win32') return undefined;

  const digest = createHash('sha256').update(canonicalRootDir(rootDir), 'utf8').digest('hex').slice(0, HASH_LENGTH);

  return `\\\\.\\pipe\\${PIPE_PREFIX}${digest}`;
}

function canonicalRootDir(rootDir: string): string {
  const canonical = readCanonicalPath(rootDir) ?? resolve(rootDir);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

// `realpathSync.native` is the filesystem's own answer, and it throws when the directory does not
// exist — an ordinary case here rather than an error, since a client may ask before anything has
// created the data directory. The lexical form stands in, and the two only meet because case is taken
// out of the comparison.
function readCanonicalPath(rootDir: string): string | undefined {
  try {
    return realpathSync.native(rootDir);
  } catch {
    return undefined;
  }
}
