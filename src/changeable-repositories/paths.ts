// Reading a directory the way this module's identity rule needs it read: canonical, or not at all.
//
// This is the one place in the slice that touches the filesystem, and it is kept out of `state.ts` on
// purpose. `state.ts` decides what a request means; this decides what a path *is*, and the second
// question needs a disk while the first does not. Keeping them apart is what lets the transitions be
// asserted on a machine where the directories in the test do not exist.
//
// Why resolve at all, when the sibling plugin stores its members byte for byte and says in its own
// header that it asks nothing about what a designation names? Because that plugin's members are never
// compared to anything, and these are: the check this authority exists to support is "is this target
// inside a directory the human named", and a comparison needs two spellings of one directory to be
// one member. Resolving here is not an attempt to guess what the human meant — it is the identity
// rule the comparison will need, applied at admission so the set is well-formed by construction.
//
// The consequence, stated because it is real: a resolved member is a snapshot of the filesystem at
// declaration time. Retarget a symlink afterwards and the declaration still names the old target; the
// authorization does not silently follow the link, which is the safer half of that behaviour, and the
// other half is that a directory renamed afterwards leaves a member that no longer resolves. That
// fails closed — a later check simply finds nothing — and it is the reason `status` exists.

import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/**
 * What reading a path produced, and the two failures are kept apart because the human is told which.
 *
 * `not-absolute` is checked first and never touches the disk: a relative path cannot be a member,
 * because the same string would name different directories depending on where the resident happens
 * to be running, and an authority that depends on the caller's working directory is not one.
 */
export type PathReading =
  | { readonly kind: 'ok'; readonly canonical: string }
  | { readonly kind: 'not-absolute' }
  | { readonly kind: 'not-a-directory' };

/**
 * The reader `state.ts` is given, so that its transitions can be asserted without a disk.
 *
 * Deliberately one method: this module has exactly one question to ask about a path, and an interface
 * that could also answer others would invite the second caller that needs them.
 */
export interface DirectoryReader {
  read(value: string): PathReading;
}

/**
 * The real reader.
 *
 * `realpathSync` rather than `resolve`, because only the former follows symlinks and collapses the
 * 8.3 short names Windows still hands out; and existence is required rather than tolerated, because
 * authorizing a name that does not resolve is authorizing whatever it may become. Both are the same
 * rule seen from two sides: a member of this set is a directory that is there, identified by the one
 * canonical name for it.
 */
export const realDirectoryReader: DirectoryReader = {
  read(value: string): PathReading {
    if (!isAbsolute(value)) return { kind: 'not-absolute' };
    let canonical: string;
    try {
      canonical = realpathSync(value);
    } catch {
      // Every way this throws — missing, a broken link, a path component that is a file, a permission
      // the process does not have — means the same thing to the human: this is not a directory they
      // can authorize. Nothing here has a use for the difference.
      return { kind: 'not-a-directory' };
    }
    try {
      if (!statSync(canonical).isDirectory()) return { kind: 'not-a-directory' };
    } catch {
      return { kind: 'not-a-directory' };
    }
    return { kind: 'ok', canonical };
  },
};
