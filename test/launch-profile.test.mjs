import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  clearLaunchProfile,
  decodeLaunchProfile,
  encodeLaunchProfile,
  launchArguments,
  launchProfilePath,
  readLaunchProfile,
  renderLaunchArguments,
  writeLaunchProfile,
} from '../dist/cli/launch-profile.js';
import { parseCommandLine } from '../dist/cli/options.js';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-launch-profile-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function runCli(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.error, undefined);
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A fully-populated profile, so that every optional member is exercised at least once by the tests
// that use this. Nothing here is a default — each value is one an operator would have typed.
const FULL = Object.freeze({
  desktopAwarenessDelayMs: 1000,
  repositoryCi: Object.freeze({ rootDir: 'C:\\repo', repository: 'owner/name' }),
  model: Object.freeze({
    endpoint: 'http://127.0.0.1:9/v1',
    model: 'some-model',
    credentialEnv: 'HIKARI_TEST_KEY',
    reasoningEffort: 'high',
  }),
  proactiveCiDelayMs: 60000,
  proactiveReturn: Object.freeze({ delayMs: 1000, afterMs: 20000 }),
});

// ---------------------------------------------------------------------------------------------
// The shape: absence is a value, and JSON must not be allowed to flatten it
// ---------------------------------------------------------------------------------------------

test('缺失的键就是该 flag 缺席：undefined 的成员不写进 JSON', () => {
  const text = encodeLaunchProfile({
    desktopAwarenessDelayMs: 250,
    model: { endpoint: 'http://e', model: 'm', credentialEnv: undefined, reasoningEffort: undefined },
  });

  // Not "credentialEnv": null, and not "credentialEnv": "" — no key at all. `undefined` on this
  // member means "send no credential", and a JSON null would be a value the resident's reader would
  // then have to interpret as one.
  assert.equal(text.includes('credentialEnv'), false);
  assert.equal(text.includes('reasoningEffort'), false);

  const decoded = decodeLaunchProfile(text);
  assert.equal(decoded.kind, 'profile');
  assert.equal(decoded.profile.model.credentialEnv, undefined);
  assert.equal(decoded.profile.model.reasoningEffort, undefined);
  assert.equal(decoded.profile.repositoryCi, undefined);
  assert.equal(decoded.profile.proactiveCiDelayMs, undefined);
  assert.equal(decoded.profile.proactiveReturn, undefined);
});

test('有值的成员逐个往返，包括两个 undefined 语义的成员带值时', () => {
  const decoded = decodeLaunchProfile(encodeLaunchProfile(FULL));
  assert.equal(decoded.kind, 'profile');
  assert.deepEqual(decoded.profile, FULL);
});

test('未知的键被拒绝：解码器不是可扩展 schema', () => {
  const decoded = decodeLaunchProfile('{"desktopAwarenessDelayMs":1,"somethingNew":2}');
  assert.equal(decoded.kind, 'unreadable');
  assert.match(decoded.reason, /未知的键/);
});

test('嵌套层的未知键同样被拒绝', () => {
  const decoded = decodeLaunchProfile(
    '{"desktopAwarenessDelayMs":1,"model":{"endpoint":"e","model":"m","temperature":1}}',
  );
  assert.equal(decoded.kind, 'unreadable');
  assert.match(decoded.reason, /未知的键/);
});

test('缺少必需的键被拒绝：desktopAwarenessDelayMs 没有默认值', () => {
  const decoded = decodeLaunchProfile('{"proactiveCiDelayMs":5}');
  assert.equal(decoded.kind, 'unreadable');
  assert.match(decoded.reason, /缺少必需的键/);
});

test('类型不对被拒绝，且理由是具体的那一条', () => {
  const cases = [
    ['{"desktopAwarenessDelayMs":"1000"}', /不是一个数/],
    ['{"desktopAwarenessDelayMs":1,"model":{"endpoint":"e"}}', /缺少必需的键/],
    ['{"desktopAwarenessDelayMs":1,"model":{"endpoint":"e","model":"m","credentialEnv":7}}', /必须是字符串/],
    ['{"desktopAwarenessDelayMs":1,"proactiveReturn":{"delayMs":1}}', /缺少必需的键/],
    ['{"desktopAwarenessDelayMs":1,"proactiveReturn":[1,2]}', /不是对象/],
    ['[1,2]', /不是对象/],
    ['"a string"', /不是对象/],
  ];

  for (const [text, expected] of cases) {
    const decoded = decodeLaunchProfile(text);
    assert.equal(decoded.kind, 'unreadable', text);
    assert.match(decoded.reason, expected, text);
  }
});

test('不是 JSON 就是不合法，理由只说这一件事', () => {
  const decoded = decodeLaunchProfile('not json at all');
  assert.equal(decoded.kind, 'unreadable');
  assert.match(decoded.reason, /不是合法的 JSON/);
});

test('BOM 是编码痕迹不是形状：带 BOM 的合法 JSON 读得进来', () => {
  // Every tool an operator on this one platform reaches for to write the file by hand — PowerShell's
  // `Set-Content -Encoding utf8` among them — writes one, and `JSON.parse` refuses it outright.
  const decoded = decodeLaunchProfile(`\uFEFF${encodeLaunchProfile(FULL)}`);
  assert.equal(decoded.kind, 'profile');
  assert.deepEqual(decoded.profile, FULL);
});

test('BOM 之外不做任何归一化：尾逗号仍然是非法 JSON', () => {
  const decoded = decodeLaunchProfile('{"desktopAwarenessDelayMs":1,}');
  assert.equal(decoded.kind, 'unreadable');
  assert.match(decoded.reason, /不是合法的 JSON/);
});

// ---------------------------------------------------------------------------------------------
// The invariant the whole slice rests on
// ---------------------------------------------------------------------------------------------

test('每一次启动都能写成一条既有的 hikari resident 命令行：逐字对照', () => {
  assert.deepEqual(launchArguments('D:\\data', FULL), [
    'resident',
    '--data-dir',
    'D:\\data',
    '--desktop-awareness-delay-ms',
    '1000',
    '--repository-root',
    'C:\\repo',
    '--repository',
    'owner/name',
    '--model-endpoint',
    'http://127.0.0.1:9/v1',
    '--model',
    'some-model',
    '--model-credential-env',
    'HIKARI_TEST_KEY',
    '--model-reasoning-effort',
    'high',
    '--proactive-ci-delay-ms',
    '60000',
    '--proactive-return-delay-ms',
    '1000',
    '--proactive-return-after-ms',
    '20000',
  ]);
});

test('一个最小 profile 只写出一条最小命令行，不补任何默认', () => {
  assert.deepEqual(launchArguments('D:\\data', { desktopAwarenessDelayMs: 0 }), [
    'resident',
    '--data-dir',
    'D:\\data',
    '--desktop-awareness-delay-ms',
    '0',
  ]);
});

test('profile 里不可能存下 resident 会拒绝的配置：每条启动都由它自己的 reader 读回', () => {
  // This is the load-bearing consequence of `profile set` reusing `readResidentOptions`. The array
  // below is exactly what the console hands to a new process, and it is run through the very reader
  // that process will run it through.
  const parsed = parseCommandLine(launchArguments('D:\\data', FULL));
  assert.equal(parsed.command, 'resident');
  assert.equal(parsed.options.dataDir, 'D:\\data');
  assert.equal(parsed.options.desktopAwarenessDelayMs, 1000);
  assert.deepEqual(parsed.options.repositoryCi, { rootDir: 'C:\\repo', repository: 'owner/name' });
  assert.equal(parsed.options.model.endpoint, 'http://127.0.0.1:9/v1');
  assert.equal(parsed.options.model.credentialEnv, 'HIKARI_TEST_KEY');
  assert.equal(parsed.options.proactiveReturn.afterMs, 20000);
});

test('读回来的结果再写出去是同一条命令行：这条不变量是幂等的', () => {
  const once = launchArguments('D:\\data', FULL);
  const again = launchArguments('D:\\data', parseCommandLine(once).options);
  assert.deepEqual(again, once);
});

test('缺席的成员在读回之后仍然缺席，不会被补成默认值', () => {
  const minimal = { desktopAwarenessDelayMs: 1000 };
  const parsed = parseCommandLine(launchArguments('D:\\data', minimal));
  assert.equal(parsed.options.model, undefined);
  assert.equal(parsed.options.repositoryCi, undefined);
  assert.equal(parsed.options.proactiveCiDelayMs, undefined);
  assert.equal(parsed.options.proactiveReturn, undefined);
});

test('等价命令行的显示形式只在该拆开的地方加引号', () => {
  assert.equal(renderLaunchArguments(['resident', '--data-dir', 'C:\\a b']), 'hikari resident --data-dir "C:\\a b"');
  assert.equal(renderLaunchArguments(['resident', '--data-dir', 'D:\\data']), 'hikari resident --data-dir D:\\data');
});

// ---------------------------------------------------------------------------------------------
// Where it lives
// ---------------------------------------------------------------------------------------------

test('profile 住在数据目录里，没有第二个位置', (t) => {
  const root = createRoot(t);
  assert.equal(launchProfilePath(root), join(root, 'launch.json'));

  writeLaunchProfile(root, FULL);
  // Read back through the reader, not through the process that wrote it.
  assert.deepEqual(readLaunchProfile(root).profile, FULL);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'launch.json'), 'utf8')).model.model, 'some-model');

  clearLaunchProfile(root);
  assert.deepEqual(readLaunchProfile(root), { kind: 'none' });
  // Idempotent: clearing a profile that was never written is the ordinary case, not an error.
  clearLaunchProfile(root);
});

test('读不到与读不坏是两种答案，文件不存在是 none 而不是 unreadable', (t) => {
  const root = createRoot(t);
  assert.deepEqual(readLaunchProfile(root), { kind: 'none' });

  writeFileSync(join(root, 'launch.json'), '{ broken', 'utf8');
  const unreadable = readLaunchProfile(root);
  assert.equal(unreadable.kind, 'unreadable');
  assert.match(unreadable.reason, /不是合法的 JSON/);
});

// ---------------------------------------------------------------------------------------------
// The command line surface
// ---------------------------------------------------------------------------------------------

test('profile show 在没有配置时说明路径，并以非零退出而不是沉默', (t) => {
  const root = createRoot(t);
  const result = runCli('profile', 'show', '--data-dir', root);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /还没有启动配置/);
  assert.match(result.stderr, /launch\.json/);
  assert.match(result.stderr, /hikari profile set/);
});

test('profile set 之后 show 给出的正是那条等价命令', (t) => {
  const root = createRoot(t);
  const set = runCli(
    'profile',
    'set',
    '--data-dir',
    root,
    '--desktop-awareness-delay-ms',
    '1000',
    '--model-endpoint',
    'http://127.0.0.1:9/v1',
    '--model',
    'm',
  );
  assert.equal(set.code, 0);

  const show = runCli('profile', 'show', '--data-dir', root);
  assert.equal(show.code, 0);
  assert.match(show.stdout, /等价命令：hikari resident --data-dir /);
  assert.match(show.stdout, /--model-endpoint http:\/\/127\.0\.0\.1:9\/v1 --model m/);
  // The line it printed is the line it would run.
  assert.equal(show.stdout.includes(`--data-dir ${root}`), true);
});

test('profile set 走的是 resident 自己的 reader：半给的 pair 被同一句话拒绝，且什么都不写', (t) => {
  const root = createRoot(t);
  const result = runCli(
    'profile',
    'set',
    '--data-dir',
    root,
    '--desktop-awareness-delay-ms',
    '1000',
    '--model-endpoint',
    'http://127.0.0.1:9/v1',
  );

  assert.equal(result.code, 2);
  assert.match(result.stderr, /--model-endpoint 需要与 --model 成对出现；缺少：--model/);
  // The point of the assertion below is that no profile exists: a profile that let a half-given
  // configuration through would be the resident's reader disagreeing with itself depending on who
  // asked.
  assert.deepEqual(readLaunchProfile(root), { kind: 'none' });
});

test('profile clear 清掉之后是 clear，再一次是非零退出', (t) => {
  const root = createRoot(t);
  writeLaunchProfile(root, { desktopAwarenessDelayMs: 1000 });

  const cleared = runCli('profile', 'clear', '--data-dir', root);
  assert.equal(cleared.code, 0);
  assert.match(cleared.stdout, /已清除启动配置/);

  const again = runCli('profile', 'clear', '--data-dir', root);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /没有启动配置可以清除/);
});

test('profile 的未知子命令是用法错误，不是被忽略的拼写', () => {
  const result = runCli('profile', 'reset', '--data-dir', 'D:\\data');
  assert.equal(result.code, 2);
  assert.match(result.stderr, /只支持 set \/ show \/ clear/);
});

test('profile 的每个子命令都要求 --data-dir：没有默认目录可替换', (t) => {
  const root = createRoot(t);
  for (const word of ['set', 'show', 'clear']) {
    const args = word === 'set' ? ['--desktop-awareness-delay-ms', '1000'] : [];
    const result = runCli('profile', word, ...args);
    assert.equal(result.code, 2, word);
    assert.match(result.stderr, /--data-dir/, word);
  }
  // And the path shown when there is nothing to show is the one that was asked about, not a guess.
  assert.equal(readLaunchProfile(root).kind, 'none');
});

