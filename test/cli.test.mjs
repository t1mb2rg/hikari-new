import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { openChronicle, resolveChroniclePath } from '../dist/chronicle/index.js';
import { resolveOriginPath, restoreHikari } from '../dist/continuity/index.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OTHER_HIKARI_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';
const VALID_OCCURRED_AT = '2026-01-01T00:00:00.000Z';

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function snapshot(root) {
  const files = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(root, full).replaceAll('\\', '/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

function initialize(root) {
  assert.equal(runCli('init', '--data-dir', root).code, 0);
}

test('hikari init creates a Hikari in an empty directory', (t) => {
  const root = createRoot(t);

  const result = runCli('init', '--data-dir', root);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const stored = JSON.parse(readFileSync(resolveOriginPath(root), 'utf8'));
  assert.equal(stored.kind, 'hikari-origin');
  assert.match(stored.hikariId, UUID_V4);
  assert.match(result.stdout, new RegExp(stored.hikariId));
});

test('hikari init does not create a chronicle store', (t) => {
  const root = createRoot(t);

  initialize(root);

  assert.deepEqual(readdirSync(root), ['continuity']);
  assert.equal(existsSync(join(root, 'chronicle')), false);
});

test('hikari init refuses to run twice and leaves the origin record untouched', (t) => {
  const root = createRoot(t);
  initialize(root);
  const before = readFileSync(resolveOriginPath(root), 'utf8');

  const second = runCli('init', '--data-dir', root);

  assert.notEqual(second.code, 0);
  assert.equal(second.stdout, '');
  assert.match(second.stderr, /already initialized/);
  assert.equal(readFileSync(resolveOriginPath(root), 'utf8'), before);
});

test('hikari chronicle init fails when the Hikari does not exist', (t) => {
  const root = createRoot(t);

  const result = runCli('chronicle', 'init', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /origin record does not exist/);
  assert.match(result.stderr, /hikari init/);
});

test('hikari chronicle init never initializes a missing Hikari', (t) => {
  const root = createRoot(t);

  runCli('chronicle', 'init', '--data-dir', root);

  assert.deepEqual(snapshot(root), {});
});

test('hikari chronicle init creates a store owned by the existing Hikari', (t) => {
  const root = createRoot(t);
  initialize(root);
  const identity = restoreHikari({ rootDir: root });

  const result = runCli('chronicle', 'init', '--data-dir', root);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const [header] = readFileSync(resolveChroniclePath(root), 'utf8').split('\n');
  assert.equal(JSON.parse(header).owner, identity.hikariId);
});

test('hikari chronicle init leaves the origin record untouched', (t) => {
  const root = createRoot(t);
  initialize(root);
  const before = readFileSync(resolveOriginPath(root), 'utf8');

  runCli('chronicle', 'init', '--data-dir', root);

  assert.equal(readFileSync(resolveOriginPath(root), 'utf8'), before);
});

test('hikari chronicle init refuses to run twice and leaves the store untouched', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  const before = readFileSync(resolveChroniclePath(root), 'utf8');

  const second = runCli('chronicle', 'init', '--data-dir', root);

  assert.notEqual(second.code, 0);
  assert.match(second.stderr, /already initialized/);
  assert.equal(readFileSync(resolveChroniclePath(root), 'utf8'), before);
});

test('hikari start fails when nothing exists', (t) => {
  const root = createRoot(t);

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /无法确认长期主体/);
  assert.match(result.stderr, /continuity 状态：failed/);
  assert.match(result.stderr, /chronicle 状态：waiting/);
  assert.match(result.stderr, /hikari init/);
});

test('hikari start creates no persistent state when nothing exists', (t) => {
  const root = createRoot(t);

  runCli('start', '--data-dir', root);

  assert.deepEqual(snapshot(root), {});
});

test('hikari start fails when only the Hikari exists', (t) => {
  const root = createRoot(t);
  initialize(root);

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /长期主体已恢复/);
  assert.match(result.stderr, /continuity 状态：active/);
  assert.match(result.stderr, /chronicle 状态：failed/);
  assert.match(result.stderr, /Chronicle store does not exist/);
  assert.match(result.stderr, /hikari chronicle init/);
  assert.doesNotMatch(result.stderr, /无法确认长期主体/);
});

test('hikari start does not create the missing chronicle store', (t) => {
  const root = createRoot(t);
  initialize(root);

  runCli('start', '--data-dir', root);

  assert.deepEqual(readdirSync(root), ['continuity']);
});

test('hikari start does not initialize a Hikari without an origin record', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  rmSync(resolveOriginPath(root));

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.equal(existsSync(resolveOriginPath(root)), false);
  assert.match(result.stderr, /无法确认长期主体/);
});

test('hikari start succeeds when both the Hikari and the store exist', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);

  const result = runCli('start', '--data-dir', root);

  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /continuity 状态：active/);
  assert.match(result.stdout, /chronicle 状态：active/);
});

test('hikari start leaves every persistent byte unchanged', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  const before = snapshot(root);

  const result = runCli('start', '--data-dir', root);

  assert.equal(result.code, 0);
  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(Object.keys(before).sort(), [
    'chronicle/chronicle.jsonl',
    'continuity/origin.json',
  ]);
});

test('two consecutive starts recover the same Hikari', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  const created = restoreHikari({ rootDir: root }).hikariId;
  const before = snapshot(root);

  assert.equal(runCli('start', '--data-dir', root).code, 0);
  assert.equal(runCli('start', '--data-dir', root).code, 0);

  assert.equal(restoreHikari({ rootDir: root }).hikariId, created);
  assert.deepEqual(snapshot(root), before);
});

test('facts already recorded survive two starts unchanged', async (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  const identity = restoreHikari({ rootDir: root });
  const service = openChronicle({ rootDir: root, identity });
  const appended = await service.append({
    type: 'cli.test',
    version: 1,
    occurredAt: VALID_OCCURRED_AT,
    source: { kind: 'test' },
    payload: { note: 'kept' },
  });
  const before = snapshot(root);

  assert.equal(runCli('start', '--data-dir', root).code, 0);
  assert.equal(runCli('start', '--data-dir', root).code, 0);

  assert.deepEqual(snapshot(root), before);
  assert.deepEqual(await openChronicle({ rootDir: root, identity }).read(), [appended]);
});

test('hikari start reports an owner mismatch without claiming the Hikari is absent', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  writeFileSync(
    resolveOriginPath(root),
    JSON.stringify({
      kind: 'hikari-origin',
      version: 1,
      hikariId: OTHER_HIKARI_ID,
      createdAt: VALID_OCCURRED_AT,
    }),
  );

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /长期主体已恢复/);
  assert.match(result.stderr, /continuity 状态：active/);
  assert.match(result.stderr, /Chronicle store belongs to/);
  assert.doesNotMatch(result.stderr, /不存在/);
});

test('hikari start reports a corrupt store without claiming the Hikari is absent', (t) => {
  const root = createRoot(t);
  initialize(root);
  runCli('chronicle', 'init', '--data-dir', root);
  writeFileSync(resolveChroniclePath(root), 'not json\n');

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /长期主体已恢复/);
  assert.match(result.stderr, /Chronicle store is invalid/);
  assert.doesNotMatch(result.stderr, /不存在/);
});

test('hikari start reports a corrupt origin record without offering to initialize', (t) => {
  const root = createRoot(t);
  initialize(root);
  const before = snapshot(root);
  writeFileSync(resolveOriginPath(root), 'not json');

  const result = runCli('start', '--data-dir', root);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /无法确认长期主体/);
  assert.match(result.stderr, /Hikari origin record is invalid/);
  assert.doesNotMatch(result.stderr, /hikari init/);
  assert.equal(readFileSync(resolveOriginPath(root), 'utf8'), 'not json');
  assert.equal(snapshot(root)['chronicle/chronicle.jsonl'], before['chronicle/chronicle.jsonl']);
});

test('hikari rejects a missing data directory argument', (t) => {
  const result = runCli('init');

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /--data-dir/);
  assert.match(result.stderr, /用法/);
});

test('hikari rejects an unknown command', () => {
  const result = runCli('frobnicate', '--data-dir', 'ignored');

  assert.equal(result.code, 2);
  assert.match(result.stderr, /未知命令/);
});

test('hikari rejects an unknown chronicle subcommand', () => {
  const result = runCli('chronicle', 'reset', '--data-dir', 'ignored');

  assert.equal(result.code, 2);
  assert.match(result.stderr, /chronicle 只支持 init/);
});

test('hikari rejects unknown arguments', () => {
  const result = runCli('init', '--root', 'ignored');

  assert.equal(result.code, 2);
  assert.match(result.stderr, /未知参数/);
});

test('hikari rejects a blank data directory', () => {
  const result = runCli('init', '--data-dir', '   ');

  assert.equal(result.code, 2);
  assert.match(result.stderr, /空路径/);
});

test('a usage error never touches the data directory', (t) => {
  const root = createRoot(t);

  const result = runCli('init', '--data-dir', root, '--data-dir', root);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /只能指定一次/);
  assert.deepEqual(snapshot(root), {});
});
