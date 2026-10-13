import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { changeableRepositoriesFactDraft } from '../dist/changeable-repositories/facts.js';
import { realDirectoryReader } from '../dist/changeable-repositories/paths.js';
import {
  applyChangeableRepositoriesRequest,
  emptyChangeableRepositories,
  renderChangeableRepositories,
  sameMembership,
} from '../dist/changeable-repositories/state.js';

// The human-visible sentences, written out here rather than imported from the module — for the same
// reason the work focus test writes its own: a test that took the wording from the module would agree
// with whatever the module happened to say, including after somebody reworded it into something a
// human would misread.
const NONE = '这个数据目录里还没有授权任何可改仓库。';
const NOT_ABSOLUTE = (value) => `${value} 不是一个绝对路径。`;
const NOT_A_DIRECTORY = (value) => `${value} 不是一个存在的目录。`;
const REPLACE_NEEDS_ONE = 'replace 至少需要一个目录；要清空请用 clear。';

// A reader that answers from a table, so the transitions can be asserted on a machine where none of
// these directories exists. The rule under test is what a request *means*; what a path *is* is the
// other question, and it is tested below against a real disk.
const table = (readings) => ({ read: (value) => readings[value] });

const HOME = 'C:\\work\\one';
const OTHER = 'C:\\work\\two';

const reader = table({
  [HOME]: { kind: 'ok', canonical: HOME },
  [OTHER]: { kind: 'ok', canonical: OTHER },
  // Two spellings, one directory: the reader is the thing that decides this, and the state must
  // therefore never hold both.
  'C:\\work\\.\\one': { kind: 'ok', canonical: HOME },
  'C:\\work\\three': { kind: 'ok', canonical: HOME },
  'not absolute': { kind: 'not-absolute' },
  'C:\\work\\missing': { kind: 'not-a-directory' },
});

const apply = (state, request) =>
  applyChangeableRepositoriesRequest(state, request, reader);

const members = (transition) => {
  assert.equal(transition.kind, 'ok');
  return [...transition.state.repositories];
};

test('declare adds, and two spellings of one directory are one member', () => {
  const empty = emptyChangeableRepositories();

  assert.deepEqual(members(apply(empty, { word: 'declare', repositories: [HOME] })), [HOME]);

  // The second spelling is not a second member. This is the whole reason a member is admitted in its
  // canonical form, and the assertion that would fail if the reader were bypassed.
  const once = apply(empty, { word: 'declare', repositories: [HOME] }).state;
  const twice = apply(once, {
    word: 'declare',
    repositories: ['C:\\work\\.\\one', 'C:\\work\\three'],
  });
  assert.deepEqual(members(twice), [HOME]);
});

test('declare unions and replace replaces, which is the only difference between them', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  assert.deepEqual(
    members(apply(one, { word: 'declare', repositories: [OTHER] })),
    [HOME, OTHER],
  );
  assert.deepEqual(
    members(apply(one, { word: 'replace', repositories: [OTHER] })),
    [OTHER],
  );
});

test('replace with nothing is refused, and declare with nothing is not', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  // The empty set has exactly one way in — `clear` — and a second spelling of it would be a second
  // thing to keep in step.
  const refused = apply(one, { word: 'replace', repositories: [] });
  assert.equal(refused.kind, 'refused');
  assert.equal(refused.reason, REPLACE_NEEDS_ONE);

  // `declare` with nothing names no directory that could be wrong, so it is a no-op rather than a
  // mistake: it cannot move the set, and it answers like anything else that could not.
  const noop = apply(one, { word: 'declare', repositories: [] });
  assert.equal(noop.kind, 'ok');
  assert.ok(sameMembership(one, noop.state));
});

test('clear empties whatever was there', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME, OTHER],
  }).state;

  assert.deepEqual(members(apply(one, { word: 'clear' })), []);
});

test('a directory that is not there, or not absolute, is refused by name as it arrived', () => {
  const empty = emptyChangeableRepositories();

  // Quoted as it arrived: the canonical form does not exist in the failing case, and echoing a
  // resolved form back would be showing the human something they did not type.
  const relative = apply(empty, { word: 'declare', repositories: ['not absolute'] });
  assert.equal(relative.kind, 'refused');
  assert.equal(relative.reason, NOT_ABSOLUTE('not absolute'));

  const missing = apply(empty, { word: 'declare', repositories: ['C:\\work\\missing'] });
  assert.equal(missing.kind, 'refused');
  assert.equal(missing.reason, NOT_A_DIRECTORY('C:\\work\\missing'));
});

test('a refused request leaves the set exactly where it was', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  // The refusal is per-request, not per-member: a `replace` whose second entry is bad must not leave
  // the first one admitted. Anything else would make the set a function of how far the loop got.
  const refused = apply(one, {
    word: 'replace',
    repositories: [OTHER, 'C:\\work\\missing'],
  });
  assert.equal(refused.kind, 'refused');
  // A refusal carries no state at all, which is what makes "the set did not move" a property of the
  // shape rather than a promise the caller has to keep.
  assert.equal(refused.state, undefined);
  assert.deepEqual(members({ kind: 'ok', state: one }), [HOME]);
});

test('sameMembership is a claim about the set, not about the array', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const same = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const other = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [OTHER],
  }).state;

  assert.ok(sameMembership(one, same));
  assert.ok(!sameMembership(one, other));
  // A rebuild that produced an equal set is equal, and the very same object is equal to itself.
  assert.ok(sameMembership(one, one));
});

test('the empty set is a sentence and the members are the answer', () => {
  assert.deepEqual([...renderChangeableRepositories(emptyChangeableRepositories())], [NONE]);

  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  // No header: the set is the answer, and a heading would be decoration on a list of paths that are
  // already the whole of it.
  assert.deepEqual([...renderChangeableRepositories(one)], [HOME]);
});

test('three words write a fact and status writes none', () => {
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;

  assert.equal(changeableRepositoriesFactDraft({ word: 'status' }, one), undefined);

  const declared = changeableRepositoriesFactDraft({ word: 'declare', repositories: [HOME] }, one);
  assert.equal(declared.type, 'changeable-repositories.declared');
  assert.equal(declared.version, 1);
  assert.equal(declared.source.kind, 'changeable-repositories.declaration');
  assert.deepEqual(declared.payload.repositories, [HOME]);

  const replaced = changeableRepositoriesFactDraft({ word: 'replace', repositories: [OTHER] }, one);
  assert.equal(replaced.type, 'changeable-repositories.replaced');

  // Nothing, not `{ repositories: [] }`: an empty set can only hold one value, so a payload repeating
  // it would be a field with one legal content.
  const cleared = changeableRepositoriesFactDraft({ word: 'clear' }, emptyChangeableRepositories());
  assert.equal(cleared.type, 'changeable-repositories.cleared');
  assert.deepEqual(cleared.payload, {});
});

test('the fact carries the set the transition left behind, not the request that moved it', () => {
  // This is the family's whole difference from the work focus's: a new activation rebuilds the set by
  // reading it back, so a payload that recorded only what the word did would make read-back a replay.
  const one = apply(emptyChangeableRepositories(), {
    word: 'declare',
    repositories: [HOME],
  }).state;
  const both = apply(one, { word: 'declare', repositories: [OTHER] }).state;

  const draft = changeableRepositoriesFactDraft({ word: 'declare', repositories: [OTHER] }, both);
  assert.deepEqual(draft.payload.repositories, [HOME, OTHER]);
});

test('the real reader resolves through a dot segment and refuses what is not there', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hikari-change-')));
  try {
    const nested = join(root, 'nested');
    mkdirSync(nested);

    // A member is the directory, identified by the one canonical name for it — so a path that walks
    // through a dot segment is admitted as the same member, not as a second spelling of it.
    const throughDot = join(root, 'nested', '..', 'nested');
    const reading = realDirectoryReader.read(throughDot);
    assert.equal(reading.kind, 'ok');
    assert.equal(reading.canonical, nested);

    assert.equal(realDirectoryReader.read('relative').kind, 'not-absolute');
    assert.equal(realDirectoryReader.read(join(root, 'nope')).kind, 'not-a-directory');
    // A file is not a directory, and the answer is the same one a missing path gets: the human has one
    // thing to fix either way.
    const file = join(root, 'file.txt');
    writeFileSync(file, '');
    assert.equal(realDirectoryReader.read(file).kind, 'not-a-directory');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real reader does not follow a member when a link is retargeted later', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hikari-change-')));
  try {
    const real = join(root, 'real');
    mkdirSync(real);
    const link = join(root, 'link');
    try {
      symlinkSync(real, link, 'junction');
    } catch {
      // Creating a link can need a privilege this machine may not have. The assertion below is about
      // what a resolved member means, and it is worth skipping rather than weakening.
      return;
    }

    // Resolved at admission: the member names the directory that was there, not the name that pointed
    // at it. The authorization does not silently follow a link that is retargeted afterwards — which
    // is the safer half of the behaviour, and the reason `status` exists for the other half.
    const reading = realDirectoryReader.read(link);
    assert.equal(reading.kind, 'ok');
    assert.equal(reading.canonical, real);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
