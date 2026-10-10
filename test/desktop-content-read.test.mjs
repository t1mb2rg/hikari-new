import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { requestDesktopContentRead } from '../dist/cli/content.js';
import { desktopSessionAwarenessAssessedEvent } from '../dist/desktop-session-awareness-loop/index.js';
import {
  ContentReadLineReader,
  CONTENT_READ_WINDOW_SOURCE,
  contentReadEndpointPath,
  createDesktopContentReadPlugin,
  decideContentRead,
  decodeContentReadReply,
  decodeContentReadRequest,
  DESKTOP_CONTENT_READ_PROTOCOL_VERSION,
  desktopContentReadPlugin,
  encodeContentReadReply,
  encodeContentReadRequest,
  isAdmissibleSample,
  isWalkTimeout,
  latestAdmissibleSample,
  MAX_CONTENT_READ_REPLY_LINE,
  MAX_CONTENT_READ_REQUEST_LINE,
  READ_MAX_CHARS,
  READ_MAX_DEPTH,
  READ_MAX_NODES,
  renderContentRead,
  toWindowIdentity,
  WALKER,
} from '../dist/desktop-content-read/index.js';
// Deliberately not in the package index: the real walker is reached here the way a composition reaches
// it, and it is imported by path so that its absence from the public surface stays visible.
import { createWindowsWalker } from '../dist/desktop-content-read/uia.js';
import { Runtime } from '../dist/index.js';

// Two halves, in one file, for the reason `desktop-session-observe.test.mjs` records having already
// learned once in this repository: splitting them along the pipe would put every claim this surface
// makes about its own attribution rule on the side of the split CI cannot run on every platform.
//
// The pure half is the larger one and it is not a consolation prize. `isAdmissibleSample` is the rule
// Check A of the mandate turned on, `decideContentRead` is where `truncated` and `empty` are told
// apart, and `renderContentRead` is the only place §3.7's capability gap is carried outward. All three
// are pure functions of already-public values, so all three are checked everywhere.
const NO_PIPES = process.platform === 'win32' ? false : '命名管道只在 Windows 上存在';

// A third axis, and a narrower one than `NO_PIPES`. Two of the tests below run the *shipped PowerShell*
// rather than any TypeScript, because the defects they pin are in the script text — a datetime format
// string and the order of two statements — and neither is reachable through the injected walker the
// rest of this file uses. They need a Windows host with PowerShell and nothing else; they do not need a
// window, a pipe or a resident.
const NO_POWERSHELL = process.platform === 'win32' ? false : 'PowerShell 只在 Windows 上存在';

const CLI = join(import.meta.dirname, '..', 'dist', 'cli', 'main.js');
const SRC = join(import.meta.dirname, '..', 'src');

// The walk script as it ships, which is a file rather than a string in `uia.js` — see the transport
// note in `src/desktop-content-read/uia.ts`. Read from `dist/` because that is what the resident runs,
// and because a test that read `src/` would pass while the build shipped something else.
const WALK_SCRIPT = join(import.meta.dirname, '..', 'dist', 'desktop-content-read', 'walk.ps1');

const OBSERVED_AT = '2026-02-01T08:30:00.000Z';
const LATER_AT = '2026-02-01T08:30:05.000Z';
const READ_AT = '2026-02-01T08:30:09.000Z';

// ---------------------------------------------------------------------------------------------
// Fixtures, written to the module's own shapes rather than to its convenience.
// ---------------------------------------------------------------------------------------------

function sample(overrides = {}) {
  return {
    handle: 0x7a2f14,
    title: '示例窗口',
    processName: 'Code',
    processId: 23196,
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function windowIdentity(sampleValue = sample()) {
  return toWindowIdentity(sampleValue);
}

function walked(overrides = {}) {
  const { counted, regions, ...rest } = overrides;
  return {
    kind: 'walked',
    readAt: READ_AT,
    regions: regions ?? [
      {
        id: 'window-client-area',
        viewportRelation: 'inside',
        notVisibleBecause: null,
        nodes: [{ text: '正文', channel: 'name', depth: 1 }],
      },
    ],
    counted: { truncatedBy: null, scanned: 12, matched: 3, textChars: 40, ...counted },
    ...rest,
  };
}

function createRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'hikari-content-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// The attribution rule. Check A of the mandate is the whole of why this is a pure function.
// ---------------------------------------------------------------------------------------------

test('句柄必须是一个真实存在的窗口', () => {
  // Zero is the value Windows uses for "no window", and it is also what a probe that failed to read
  // the foreground window returns. Admitting it would mean a read addressed to the desktop.
  assert.equal(isAdmissibleSample(sample({ handle: 0 })), false);
  assert.equal(isAdmissibleSample(sample({ handle: -1 })), false);
  assert.equal(isAdmissibleSample(sample({ handle: 1.5 })), false);
  assert.equal(isAdmissibleSample(sample({ handle: Number.NaN })), false);
  assert.equal(isAdmissibleSample(sample({ handle: 1 })), true);
});

test('读不出进程名的窗口不被采纳，而不是被当作「大概不是 Hikari」', () => {
  // The rule fails closed. A name that could not be read is not evidence about what the window is, so
  // it cannot be the evidence that admits it.
  assert.equal(isAdmissibleSample(sample({ processName: null })), false);
  assert.equal(isAdmissibleSample(sample({ processName: '' })), false);
  assert.equal(isAdmissibleSample(sample({ processName: 'Code' })), true);
});

test('Hikari 自己绘制在里面的终端宿主不被当成人正在读的窗口', () => {
  // The load-bearing exclusion, and the one that is an approximation. Each of these is a real process
  // name a human can be running Hikari's CLI inside.
  for (const name of [
    'WindowsTerminal',
    'windowsterminal', // compared lower-cased: a case-sensitive test would admit this one
    'WINDOWSTERMINAL',
    'OpenConsole',
    'conhost',
    'cmd',
    'powershell',
    'pwsh',
    'mintty',
    'alacritty',
    'wezterm',
    'HumanSurface',
  ]) {
    assert.equal(
      isAdmissibleSample(sample({ processName: name })),
      false,
      `${name} 是 Hikari 自己的表面，不应被采纳`,
    );
  }

  // And an ordinary application is not caught by it.
  for (const name of ['Code', 'msedge', 'explorer', 'WINWORD', 'WindowsTerminalBackup']) {
    assert.equal(isAdmissibleSample(sample({ processName: name })), true, name);
  }
});

test('目标取的是最近观测到的可采纳样本，按观测时间而不是到达顺序', () => {
  // The two differ whenever a probe completes out of order, which is possible because probes run
  // detached from the occurrence that started them. Ordering by arrival would order this plugin's
  // scheduling; the timestamp is the only field in a sample that is a fact about the desktop.
  const older = sample({ observedAt: OBSERVED_AT, handle: 11 });
  const newer = sample({ observedAt: LATER_AT, handle: 22 });

  assert.equal(latestAdmissibleSample([older, newer]).handle, 22);
  // Reversed arrival, same answer.
  assert.equal(latestAdmissibleSample([newer, older]).handle, 22);
});

test('不可采纳的样本不参与选择，即使它更新', () => {
  const admissible = sample({ observedAt: OBSERVED_AT, handle: 11 });
  const terminal = sample({ observedAt: LATER_AT, handle: 22, processName: 'WindowsTerminal' });

  assert.equal(latestAdmissibleSample([admissible, terminal]).handle, 11);
  assert.equal(latestAdmissibleSample([terminal]), undefined);
  assert.equal(latestAdmissibleSample([]), undefined);
});

test('窗口身份把句柄拼成 Windows 的十六进制写法，并保留观测时间', () => {
  const identity = toWindowIdentity(sample({ handle: 0x7a2f14 }));

  // Sixteen digits, uppercase, and the same digits a human reads off any Windows tool.
  assert.equal(identity.handle, '0x00000000007A2F14');
  assert.equal(identity.source, CONTENT_READ_WINDOW_SOURCE);
  // The observation time travels, and it is not the read time. Check A is the reason both exist.
  assert.equal(identity.observedAt, OBSERVED_AT);
  assert.notEqual(identity.observedAt, READ_AT);
  assert.equal(identity.title, '示例窗口');
  assert.equal(identity.processName, 'Code');
});

// ---------------------------------------------------------------------------------------------
// The five kinds, and the two orderings inside `decideContentRead` that are load-bearing.
// ---------------------------------------------------------------------------------------------

test('窗口读不到和窗口不回答是两个答案，从不合并', () => {
  const window = windowIdentity();

  const unreadable = decideContentRead({ kind: 'unreadable', reason: '句柄已经不存在了。' }, window);
  assert.equal(unreadable.kind, 'unreadable');
  assert.equal(unreadable.note, '句柄已经不存在了。');

  const refused = decideContentRead({ kind: 'refused', reason: '窗口没有在时限内应答。' }, window);
  assert.equal(refused.kind, 'refused');
  assert.equal(refused.note, '窗口没有在时限内应答。');

  // Both carry the window, because a result must say which window it is about even when it has no
  // content for it — §3.4's third guard.
  assert.deepEqual(unreadable.window, window);
  assert.deepEqual(refused.window, window);
});

test('被截断的遍历即使一个节点都没匹配上，也不是「空」', () => {
  // The ordering that this test exists for. A walk that hit its bound and found nothing has not
  // established that the window has no text — it established that it stopped looking. Reading it as
  // `empty` would report a fact about the window that was never measured.
  const truncated = decideContentRead(
    walked({ counted: { truncatedBy: 'nodes', scanned: READ_MAX_NODES, matched: 0, textChars: 0 }, regions: [] }),
    windowIdentity(),
  );

  assert.equal(truncated.kind, 'truncated');
  assert.equal(truncated.bounds.truncatedBy, 'nodes');
});

test('走完三个边界又没有内容的，才是「空」', () => {
  const empty = decideContentRead(
    walked({ counted: { truncatedBy: null, matched: 0, textChars: 0 }, regions: [] }),
    windowIdentity(),
  );

  assert.equal(empty.kind, 'empty');
  assert.match(empty.note, /没有在其中找到任何文本/);
  // `empty` carries no regions, which is why `renderContentRead` emits no geometry note for it.
  assert.equal('regions' in empty, false);
});

test('有内容、没触边界的是一次正常读取', () => {
  const read = decideContentRead(walked(), windowIdentity());

  assert.equal(read.kind, 'read');
  assert.equal(read.readAt, READ_AT);
  assert.equal(read.regions.length, 1);
});

test('三个上限都来自 types.ts，没有在别处另写一套数字', () => {
  const read = decideContentRead(walked(), windowIdentity());

  assert.equal(read.bounds.maxDepth, READ_MAX_DEPTH);
  assert.equal(read.bounds.maxNodes, READ_MAX_NODES);
  assert.equal(read.bounds.maxChars, READ_MAX_CHARS);
});

// ---------------------------------------------------------------------------------------------
// The rendering, and the one claim it must never be read as making.
// ---------------------------------------------------------------------------------------------

test('五种结果都说出自己读了哪个窗口', () => {
  const window = windowIdentity();
  const readings = [
    decideContentRead(walked(), window),
    decideContentRead(walked({ counted: { matched: 0, textChars: 0 }, regions: [] }), window),
    decideContentRead(walked({ counted: { truncatedBy: 'chars' } }), window),
    decideContentRead({ kind: 'refused', reason: '没有应答。' }, window),
    decideContentRead({ kind: 'unreadable', reason: '读不到。' }, window),
  ];

  assert.deepEqual(
    readings.map((read) => read.kind),
    ['read', 'empty', 'truncated', 'refused', 'unreadable'],
  );

  for (const read of readings) {
    const text = renderContentRead(read).join('\n');
    assert.match(text, /窗口句柄：0x00000000007A2F14/, read.kind);
    assert.match(text, /窗口观测时间：2026-02-01T08:30:00\.000Z/, read.kind);
    assert.match(text, /窗口来源：desktop-content-read\.windows-probe/, read.kind);
  }
});

test('几何注只出现在有视口关系的结果里，不跟着别的结果走', () => {
  const window = windowIdentity();
  const note = /不是真实像素可见性/;

  const withGeometry = [
    decideContentRead(walked(), window),
    decideContentRead(walked({ counted: { truncatedBy: 'depth' } }), window),
  ];
  for (const read of withGeometry) {
    assert.match(renderContentRead(read).join('\n'), note, read.kind);
  }

  // `empty` has no regions and therefore no relation to disclaim; `refused` / `unreadable` never got
  // as far as geometry. Attaching the note to them anyway would be a disclaimer about a claim that
  // was not made — which reads as a claim having been made.
  const withoutGeometry = [
    decideContentRead(walked({ counted: { matched: 0, textChars: 0 }, regions: [] }), window),
    decideContentRead({ kind: 'refused', reason: '没有应答。' }, window),
    decideContentRead({ kind: 'unreadable', reason: '读不到。' }, window),
  ];
  for (const read of withoutGeometry) {
    assert.doesNotMatch(renderContentRead(read).join('\n'), note, read.kind);
  }
});

test('几何注把 §3.7 要求的两段都带全，而不是只带一段', () => {
  // §3.7 asks for two things in the outward text rather than one, and a note carrying half of a gap is
  // worse than a shorter note: a human reads the enumeration as the complete list of what `inside`
  // fails to cover, and the class that is missing becomes the class they trust.
  //
  // The four classes are §3.7's own. The fourth is the one it is easiest to lose, because this walk
  // does frame against scrollable ancestors — so "clipping" looks handled, while the case that has no
  // representation at all is clipping by a *non*-scrollable one, which the walk never looks for.
  const rendered = renderContentRead(decideContentRead(walked(), windowIdentity())).join('\n');

  assert.match(rendered, /不是真实像素可见性/);
  for (const class_ of ['透明度', '遮挡', '非滚动祖先裁剪', '合成']) {
    assert.ok(rendered.includes(class_), `几何注应当点名 §3.7 的「${class_}」这一类`);
  }

  // And the second half of §3.7: the walk returns the document, measured at roughly twice the screen's
  // content. Without this sentence the note says the relation is geometric, but not that the set it
  // relates is larger than what a window shows — and a consumer who reads `inside` as "the human could
  // see this" is then wrong by a factor, not by an edge case.
  assert.match(rendered, /「可访问」不等于「可见」/);
  assert.match(rendered, /2 倍/);
});

test('正文里的控制字符被转义，不能冒充打印它的界面', () => {
  // `oneLine` was written for a window title and binds harder here, because this module renders body
  // text. A page whose text contains a carriage return could otherwise redraw the terminal line the
  // reader is looking at.
  // Written as escapes so this fixture cannot be mangled by an editor or a copy-paste into something
  // that no longer contains the bytes it claims to.
  const ESC = '\u001b';
  const C1 = '\u009b';
  const read = decideContentRead(
    walked({
      regions: [
        {
          id: 'window-client-area',
          viewportRelation: 'inside',
          notVisibleBecause: null,
          nodes: [
            { text: `第一行\r\n第二行${ESC}[31m红${C1}`, channel: 'text', depth: 1 },
            { text: '真实换行\n保留为转义', channel: 'name', depth: 1 },
          ],
        },
      ],
    }),
    windowIdentity(),
  );

  const lines = renderContentRead(read);
  const text = lines.join('\n');

  // The escapes are the point: the raw characters must not survive into the rendering.
  assert.equal(text.includes('\r'), false, '回车不应原样出现');
  assert.equal(text.includes(ESC), false, 'ESC 不应原样出现');
  assert.equal(text.includes(C1), false, 'C1 控制字符不应原样出现');
  assert.match(text, /\\r/);
  assert.match(text, /\\n/);
  assert.match(text, /\\u001b/);
  assert.match(text, /\\u009b/);

  // And the report has the line count of the report, not of the content: one node is one line, so a
  // body containing newlines cannot add lines to the surface.
  assert.equal(lines.filter((line) => line.includes('第一行')).length, 1);
});

test('一次合法的最大读取必须装得进客户端的应答上限，而不是被报成「入口无法访问」', () => {
  // This test exists because the constant it pins was chosen by reasoning and the reasoning was wrong.
  // "A rendered read cannot exceed the char bound plus the labelling around it" ignores that rendering
  // multiplies: `oneLine` turns one escapable character into six, and `JSON.stringify` turns its
  // backslash into a seventh. At 256 KiB the old bound sat below a legitimate read — measured at
  // 316,610 characters — and the human was told `无法访问 Hikari 桌面正文读取入口` about an entry point
  // that had answered, about a read that had completed.
  //
  // It renders the worst case rather than asserting arithmetic, because the arithmetic is the part that
  // is known to have been wrong here once already.
  // Written as an escape for the same reason the fixture above is: a raw control byte in this file
  // is a byte an editor or a copy-paste can silently remove, leaving a test that passes vacuously.
  const worst = '\u009b';
  const nodes = [];
  let used = 0;
  while (nodes.length < READ_MAX_NODES && used < READ_MAX_CHARS) {
    const take = Math.min(20, READ_MAX_CHARS - used);
    nodes.push({ text: worst.repeat(take), channel: 'name', depth: READ_MAX_DEPTH });
    used += take;
  }

  const read = decideContentRead(
    walked({
      regions: [
        { id: 'window-client-area', viewportRelation: 'inside', notVisibleBecause: null, nodes },
      ],
      counted: { truncatedBy: 'chars', scanned: READ_MAX_NODES, matched: nodes.length, textChars: used },
    }),
    windowIdentity(),
  );

  assert.equal(read.kind, 'truncated');
  assert.equal(read.bounds.textChars, READ_MAX_CHARS, '这个用例必须真的顶到字符上限');

  const encoded = encodeContentReadReply({ outcome: 'ok', lines: renderContentRead(read) });
  assert.ok(
    encoded.length <= MAX_CONTENT_READ_REPLY_LINE,
    `最大读取渲染出 ${encoded.length} 字符，超过客户端上限 ${MAX_CONTENT_READ_REPLY_LINE}`,
  );
});

test('三种「字段没有值」的说法互不代替', () => {
  const render = (title) =>
    renderContentRead(
      decideContentRead(
        { kind: 'refused', reason: '没有应答。' },
        toWindowIdentity(sample({ title })),
      ),
    ).join('\n');

  // `null` is "the probe looked and there was none"; `undefined` is "the probe did not report it".
  assert.match(render(null), /窗口标题：无（探针报告为空）/);
  assert.match(render(undefined), /窗口标题：未报告（读取结果里没有这个字段）/);
  // An empty string is a value: a caption that is present and empty. Not either of the above.
  assert.match(render(''), /窗口标题：（空字符串）/);
});

test('截断原因印出是哪一个边界停住了遍历', () => {
  const withBound = (truncatedBy) =>
    renderContentRead(
      decideContentRead(walked({ counted: { truncatedBy } }), windowIdentity()),
    ).join('\n');

  assert.match(withBound('depth'), /depth（到达深度上限 32/);
  assert.match(withBound('nodes'), /nodes（访问元素达到上限 2000/);
  assert.match(withBound('chars'), /chars（保留字符达到上限 40000/);
  assert.match(withBound(null), /截断原因：null（遍历在三个边界内结束/);
});

test('遍历方式被记下来，而不是只写在文档里', () => {
  // §3.5's "walker fixed and recorded". If this ever changes, the change is a value and not a
  // sentence in a comment.
  assert.equal(WALKER, 'ControlViewWalker');
});

// ---------------------------------------------------------------------------------------------
// `refused` has a producer, and this is where that is pinned.
//
// The tests above exercise `decideContentRead` with a `refused` walk they build by hand, which pins
// the *handling* of the kind and says nothing about whether anything can produce one. Verified before
// these tests existed: nothing could. The script has no way to observe its own slowness, so its three
// `Fail` reasons are all addressing failures, and a window that never answered came back as a thrown
// error — which `endpoint.ts` turns into `failed`, not into the kind the boundary review names
// (`§2`: 「单次读取有超时；目标无响应即 refused，不挂起」).
//
// So the rule is a predicate, and it is tested here rather than through a hung window. The wiring that
// feeds it — `execFile`'s `timeout` killing the child — is exercised only by the walk itself, and the
// end-to-end refusal needs a window that stops answering. That is NOT RUN in this file, on this
// machine or in CI, and it is listed as uncovered rather than implied by the predicate being green.
// ---------------------------------------------------------------------------------------------

test('超时是窗口没有回答，不是本进程的失败：它必须能变成 refused', () => {
  // The one case that is a fact about the window. `execFile` kills the child when the walk's own bound
  // fires, and that kill is the whole of what separates `refused` from a rejection.
  assert.equal(isWalkTimeout({ killed: true }, false), true);
});

test('被释放而杀死的子进程不算窗口没回答：那是 Hikari 自己在收摊', () => {
  // The plugin unloading kills the child too, and the child is equally dead either way. Blaming the
  // window for the teardown would report `refused` for a read that was never given a chance to finish,
  // and it would do it during shutdown, where nobody is left to read the answer.
  assert.equal(isWalkTimeout({ killed: true }, true), false);
});

test('其它失败仍然是一次失败，不会被伪装成五种结果之一', () => {
  // A non-zero exit or a child that never started. Merging these into `refused` would say the window
  // did not answer when in fact this process never managed to ask properly — the same class of error
  // as reporting a partial walk as a complete one.
  assert.equal(isWalkTimeout({}, false), false);
  assert.equal(isWalkTimeout({ killed: false, code: 1 }, false), false);
});

// ---------------------------------------------------------------------------------------------
// The wire. Reaching the endpoint at all is what Check B is about, so the envelope is checked here.
// ---------------------------------------------------------------------------------------------

test('请求的词汇只有一个词，且带操作数的请求不被当作别的问题', () => {
  const encoded = encodeContentReadRequest({ word: 'status' });
  const decoded = decodeContentReadRequest(encoded.trimEnd());

  assert.equal(decoded.kind, 'request');
  assert.equal(decoded.request.word, 'status');

  // The shape a caller would need in order to name a window. Refused, and refused as an unknown
  // request rather than silently ignored — silently ignoring it would leave a caller believing the
  // operand had been honoured.
  const naming = JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, request: 'status', handle: 1 });
  assert.equal(decodeContentReadRequest(naming).kind, 'refused');
  assert.match(decodeContentReadRequest(naming).reason, /字段必须恰好是/);

  const other = JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, request: 'read' });
  assert.equal(decodeContentReadRequest(other).kind, 'refused');
  assert.match(decodeContentReadRequest(other).reason, /未知请求/);
});

test('协议版本对不上就不解码', () => {
  const wrong = JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION + 1, request: 'status' });

  assert.equal(decodeContentReadRequest(wrong).kind, 'refused');
  assert.equal(decodeContentReadReply(wrong).kind, 'unreadable');
});

test('应答的形状在两个方向上都是封闭的', () => {
  const encoded = encodeContentReadReply({ outcome: 'ok', lines: ['a', 'b'] });
  const decoded = decodeContentReadReply(encoded.trimEnd());

  assert.equal(decoded.kind, 'reply');
  assert.equal(decoded.reply.outcome, 'ok');
  assert.deepEqual(decoded.reply.lines, ['a', 'b']);

  // An outcome outside the two is not a reply this client can act on.
  const badOutcome = JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, outcome: 'maybe', lines: [] });
  assert.equal(decodeContentReadReply(badOutcome).kind, 'unreadable');

  const badLines = JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, outcome: 'ok', lines: 'x' });
  assert.equal(decodeContentReadReply(badLines).kind, 'unreadable');

  // A JSON array is not an object, and a truncated line is not JSON.
  assert.equal(decodeContentReadReply('[]').kind, 'unreadable');
  assert.equal(decodeContentReadReply('{"protocol":').kind, 'unreadable');
});

test('行读取器在上限处正好接受，越过就溢出', () => {
  const reader = new ContentReadLineReader(8);

  assert.deepEqual(reader.push('1234'), { kind: 'pending' });
  // Exactly at the limit, with no newline yet: still a legal prefix.
  assert.deepEqual(reader.push('5678'), { kind: 'pending' });
  assert.deepEqual(reader.push('\n'), { kind: 'line', line: '12345678' });

  const overflowing = new ContentReadLineReader(8);
  overflowing.push('x'.repeat(9));
  assert.deepEqual(overflowing.push(''), { kind: 'overflow' });
});

// ---------------------------------------------------------------------------------------------
// The endpoint, over a named pipe. Everything below needs one.
// ---------------------------------------------------------------------------------------------

function fakeProbe(sampleValue) {
  return {
    sample: async () => sampleValue,
    dispose: async () => {},
  };
}

function fakeWalker(walk) {
  return {
    walk: async () => walk,
    dispose: async () => {},
  };
}

// Loads the plugin under test with an injected probe and walker, and returns a way to publish the one
// occurrence that produces a sample.
//
// The occurrence has to come from a plugin: `Runtime` keeps its bus private, and this is the same seam
// `desktop-session-awareness-loop.test.mjs` uses. It is also the honest one — the composition publishes
// this event from the awareness loop, and a test that reached around the contract to call the handler
// directly would not be checking that the subscription exists.
async function composeWith(t, createProbe, createWalker, { withProducer = true } = {}) {
  const root = createRoot(t);
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const plugin = createDesktopContentReadPlugin(createProbe, createWalker);
  assert.equal(await runtime.loadPlugin(plugin, { rootDir: root }), 'active', '测试组合应 active');

  let emitOccurrence;
  if (withProducer) {
    assert.equal(
      await runtime.loadPlugin({
        id: 'test.awareness-occurrence',
        version: '1.0.0',
        requires: [],
        provides: [],
        setup(context) {
          emitOccurrence = () => context.events.emit(desktopSessionAwarenessAssessedEvent, {});
        },
      }),
      'active',
    );
  }

  const observe = async () => {
    assert.ok(emitOccurrence, '这个组合里没有事件生产者，没有可发的事件');
    await emitOccurrence();
    // `capture` starts the probe and returns: the handler deliberately does not await it, which is the
    // property that keeps a PowerShell launch out of the awareness loop's cycle. One turn of the event
    // loop is therefore what puts the sample in the holder.
    await new Promise((resolve) => setImmediate(resolve));
  };

  return { root, runtime, plugin, observe };
}

async function compose(t, { sampleValue = sample(), walk = walked() } = {}) {
  const composed = await composeWith(
    t,
    () => fakeProbe(sampleValue),
    () => fakeWalker(walk),
  );
  await composed.observe();
  return composed;
}

test('这个插件不发布也不依赖任何 Service，也不激活在别的插件之后', () => {
  // Both empty, and both are the reviewed design rather than an omission: the one input arrives as an
  // occurrence, and nothing in the composition asks this plugin a question. The Contract Creation Gate
  // has nothing to grant.
  assert.deepEqual(desktopContentReadPlugin.requires, []);
  assert.deepEqual(desktopContentReadPlugin.provides, []);
  assert.equal(desktopContentReadPlugin.id, 'desktop-content-read');
  assert.equal(desktopContentReadPlugin.version, '1.0.0');
});

test('端点把一次读取渲染成的行原样交回来', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t, { walk: walked({ counted: { scanned: 99, matched: 7, textChars: 123 } }) });

  const answer = await requestDesktopContentRead(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok');
  assert.match(answer.reply.lines.join('\n'), /访问元素：99/);
  assert.match(answer.reply.lines.join('\n'), /贡献内容的元素：7/);
  assert.match(answer.reply.lines.join('\n'), /结果：read/);
});

test('没有可归给人类的窗口时说的是「没有目标」，不是五种结果里的任何一种', { skip: NO_PIPES }, async (t) => {
  // The window Hikari is being addressed through is a terminal, so every sample it takes is
  // inadmissible. This is the ordinary state of affairs on this machine, not an edge case.
  const { root } = await compose(t, { sampleValue: sample({ processName: 'WindowsTerminal' }) });

  const answer = await requestDesktopContentRead(root);

  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'failed');
  const text = answer.reply.lines.join('\n');
  assert.match(text, /还没有观测到可以归给人类的窗口/);
  // The five kinds are all *about a window*. None of them may appear here, because there is no window
  // to be about, and reporting one would mean reporting a target that was never observed.
  for (const kind of ['read', 'empty', 'truncated', 'refused', 'unreadable']) {
    assert.doesNotMatch(text, new RegExp(`结果：${kind}`), kind);
  }
});

test('事件生产者不在组合里时：插件照常激活，问一句得到「没有目标」，也没有发起过遍历', { skip: NO_PIPES }, async (t) => {
  // F3 of the implementation mandate. The producer is a *different plugin*, and this one declares no
  // dependency on it — that is what `requires: []` claims, and this is the composition that would
  // expose the claim as false: `desktop-content-read` loaded into a runtime where nothing can publish
  // the occurrence it subscribed to.
  //
  // This is not the test above with a different sample. There the producer exists and emits, and the
  // sample it produces is rejected; here nothing is ever emitted, which is the state a Hikari without
  // the awareness loop would be in. Three things have to hold at once. The plugin stays *active* — a
  // subscription to an event nobody publishes is not an error, and a `requires` naming the loop would
  // have turned this composition into a load failure. A read answers with the endpoint's own "no
  // target", never one of the five kinds, because there is no window for one to be about. And no walk
  // is attempted: an empty holder is not a reason to reach for a window Hikari never observed.
  let walkedTimes = 0;
  const { root } = await composeWith(
    t,
    () => fakeProbe(sample()),
    () => ({
      walk: async () => {
        walkedTimes += 1;
        return walked();
      },
      dispose: async () => {},
    }),
    { withProducer: false },
  );

  const answer = await requestDesktopContentRead(root);
  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'failed');
  assert.match(answer.reply.lines.join('\n'), /还没有观测到可以归给人类的窗口/);
  assert.equal(walkedTimes, 0, '一次样本都没有过，不应该发起任何遍历');
});

test('不可采纳的样本连一次遍历都不该发起', { skip: NO_PIPES }, async (t) => {
  // The exclusion is applied where the sample is taken, not where it is used: a terminal sample is
  // discarded rather than remembered and filtered later. This asserts the consequence — no walk at all
  // — because "the holder would not have used it" is not observable from outside.
  let walkedTimes = 0;
  const { root, observe } = await composeWith(
    t,
    () => fakeProbe(sample({ processName: 'pwsh' })),
    () => ({
      walk: async () => {
        walkedTimes += 1;
        return walked();
      },
      dispose: async () => {},
    }),
  );

  // The occurrence really happens and really produces a sample. Without this the test would pass with
  // an empty holder, which is a different reason for the same number and would keep passing after the
  // exclusion was deleted.
  await observe();

  const answer = await requestDesktopContentRead(root);
  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'failed');
  assert.equal(walkedTimes, 0, '目标不可采纳时不应读取任何窗口');
});

test('不认识的请求被拒绝，而不是被当成别的问题', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t);

  const raw = await new Promise((settle, fail) => {
    const socket = connect(contentReadEndpointPath(root));
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () =>
      socket.write(`${JSON.stringify({ protocol: DESKTOP_CONTENT_READ_PROTOCOL_VERSION, request: 'history' })}\n`),
    );
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      socket.destroy();
      settle(buffer);
    });
    socket.on('error', fail);
  });

  const decoded = decodeContentReadReply(raw.trim());
  assert.equal(decoded.kind, 'reply');
  assert.equal(decoded.reply.outcome, 'failed');
  assert.match(decoded.reply.lines.join('\n'), /未知请求/);
});

test('超长请求不被应答，连接被断开', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t);

  const closed = await new Promise((settle, fail) => {
    const socket = connect(contentReadEndpointPath(root));
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('x'.repeat(MAX_CONTENT_READ_REQUEST_LINE + 1)));
    socket.on('data', () => fail(new Error('超长请求不应有应答')));
    socket.on('close', () => settle(true));
    socket.on('error', () => settle(true));
  });

  assert.equal(closed, true);
});

// Check B of the implementation mandate, as a property rather than as a measurement.
//
// The transport is not what protects the content. The measured default DACL on a Windows named pipe
// grants Everyone and ANONYMOUS LOGON `FILE_GENERIC_READ` — they may open the pipe — and grants them
// no write right at all, which a request requires. So the protection is this: a caller who can open
// the pipe still learns nothing unless it speaks the exact envelope, and the envelope is exact.
//
// This test asserts the property in both directions. Opening without speaking gets nothing; speaking
// correctly gets an answer. A future change that answered an un-entitled opener — a greeting, a
// banner, a version handshake — would turn this green-to-red, which is the point of writing it down.
test('打开而不说话，什么也拿不到；说了正确的那一句，才拿到答案', { skip: NO_PIPES }, async (t) => {
  const { root } = await compose(t);

  const silent = await new Promise((settle, fail) => {
    const socket = connect(contentReadEndpointPath(root));
    const chunks = [];
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      // Connect, then say nothing at all. The endpoint's idle timeout is 5s; the window here is
      // bounded well under it so the test does not sit for the whole timeout.
      setTimeout(() => {
        socket.destroy();
        settle(chunks.join(''));
      }, 750);
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', fail);
  });

  assert.equal(silent, '', '一个不说话的连接不应收到任何字节');

  // And the same pipe does answer a caller that speaks the protocol.
  const answer = await requestDesktopContentRead(root);
  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok');
});

test('没有常驻时，客户端说的是「没有入口」而不是「没有观察到」', { skip: NO_PIPES, timeout: 30_000 }, async (t) => {
  const root = createRoot(t);

  const answer = await requestDesktopContentRead(root);

  // A different word from the endpoint's own `failed`. "Nothing is listening" and "the read could not
  // be attributed" are different facts about the world and are never merged.
  assert.equal(answer.kind, 'absent');
});

test('真实进程：CLI 在没有人回答的时候说没有入口', { skip: NO_PIPES, timeout: 30_000 }, (t) => {
  const root = createRoot(t);
  const result = spawnSync(process.execPath, [CLI, 'content', 'status', '--data-dir', root], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /没有|入口/);
});

// ---------------------------------------------------------------------------------------------
// The CLI surface.
// ---------------------------------------------------------------------------------------------

test('CLI 的表层：一个动词、一个名词、一个词', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  // No noun at all.
  const bare = run('content');
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /content 目前只支持 status/);

  // An unknown noun.
  const bogus = run('content', 'bogus');
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /content 目前只支持 status，收到：bogus/);

  // An unknown operand on the one noun that exists.
  const extra = run('content', 'status', '--range', 'now');
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /未知参数：--range/);

  // And it is discoverable: this CLI has no `--help`, so an unrecognised word prints the usage — which
  // is where a human finds the one spelling that exists.
  const help = run('--help');
  assert.equal(help.status, 2);
  assert.match(help.stderr, /hikari content status --data-dir <path>/);
});

// ---------------------------------------------------------------------------------------------
// What this slice must not have become.
// ---------------------------------------------------------------------------------------------

// `.ps1` as well as `.ts`, because the walk is a PowerShell file beside the TypeScript now — and the
// scans below are about *this module's* sources. Leaving it out would have been a silent coverage
// loss rather than a smaller test: `FocusedElement`, `GetForegroundWindow` and every write API all
// have a PowerShell spelling, and the one file that talks to UI Automation is where each of them
// would most plausibly appear.
const SCANNED_EXTENSIONS = ['.ts', '.ps1'];

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    else if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

// Comments removed before a source scan that is looking for a *reference*.
//
// This module's header explains at length what it refuses to do, and it names the things it refuses —
// `AutomationElement.FocusedElement` among them. A scan over raw text therefore fires on the sentence
// that promises the absence, which is the worst possible failure: the test would go red for writing the
// comment that keeps the rule alive, and the only way to make it green would be to delete the
// explanation. Stripping comments is what makes the scan check the code rather than the prose about it.
function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// PowerShell's comment character is `#`, not `//`, so `codeOnly` would strip a `.ps1` file's
// explanatory prose and call it code.
//
// Only a *line-leading* `#` is stripped, and that is deliberate. An inline rule has to know which `#`
// characters are inside strings, and a stripper that removes too much turns a scan into one that
// reports an absence it has not checked — the failure mode `codeOnly` exists to avoid, arriving from
// the other side. Every comment in `walk.ps1` is line-leading, so nothing is lost by the narrow rule,
// and a future inline comment would be scanned as code: noisy, which is the safe direction.
function stripPowerShellComments(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Whichever of the two comment strippers this file's language calls for. */
function codeOf(path) {
  const source = readFileSync(path, 'utf8');
  return path.endsWith('.ps1') ? stripPowerShellComments(source) : codeOnly(source);
}

test('没有引入通用读取 / 窗口选择 / 路由抽象', () => {
  const forbidden =
    /\b(?:ContentService|ReadService|WindowService|WindowSelector|WindowRanker|ContentRouter|DataRouter|MessageRouter|ReferenceFrame|GenericReader|GlobalWorldState)\b/;

  const offenders = sourceFiles(SRC)
    .filter((file) => forbidden.test(codeOf(file)))
    .map((file) => relative(SRC, file).replaceAll('\\', '/'));

  assert.deepEqual(offenders, []);
});

test('这个模块自己不发布任何 Service', async () => {
  const module = await import('../dist/desktop-content-read/index.js');
  const services = Object.keys(module).filter((name) => /Service$/.test(name));

  assert.deepEqual(services, []);
});

test('读取不通过全局焦点元素走捷径', () => {
  // §3.4 forbids the `FocusedElement` shortcut by name, and it is forbidden for a reason that is about
  // attribution rather than about politeness: the focused element is a fact about the machine's input
  // state right now, not about the window Hikari observed. A read that used it could return content
  // from a window that was never sampled.
  const files = sourceFiles(join(SRC, 'desktop-content-read'));
  // Asserted rather than assumed: this scan is only worth anything if `walk.ps1` is inside it now that
  // the walk is a file of its own. A scan that quietly stopped covering the UI Automation code would
  // still pass.
  assert.ok(
    files.some((file) => file.endsWith('.ps1')),
    '遍历脚本应当也在被扫描的文件里',
  );
  for (const file of files) {
    const source = codeOf(file);
    assert.doesNotMatch(source, /\bFocusedElement\b/, relative(SRC, file));
    assert.doesNotMatch(source, /\bGetFocusedElement\b/, relative(SRC, file));
  }
});

test('遍历自己不去读前台窗口：目标在观测时就定下来了', () => {
  // The probe samples the foreground window on an occurrence — that is the whole of Check A. The
  // *walker* must not: a walk that asked for the foreground window would be asking at read time, which
  // is the design the mandate rejected because the window in front then is the terminal the human
  // typed the command into.
  // Both halves of the walker, because the script moved: `FromHandle` is in `walk.ps1` now, and a test
  // that read only `uia.ts` would pass while no longer checking the file that actually calls it.
  const walker = [
    codeOnly(readFileSync(join(SRC, 'desktop-content-read', 'uia.ts'), 'utf8')),
    stripPowerShellComments(readFileSync(join(SRC, 'desktop-content-read', 'walk.ps1'), 'utf8')),
  ].join('\n');
  assert.doesNotMatch(walker, /GetForegroundWindow/);

  // And it is addressed by the handle it was given rather than by searching for a window.
  assert.match(walker, /FromHandle/);
});

test('读取入口不依赖 World、来源插件或 Chronicle', () => {
  const statements = sourceFiles(join(SRC, 'desktop-content-read')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/import\s+(?:type\s+)?[^;]*from '([^']+)'/g)].map(
      (match) => ({ text: match[0], specifier: match[1] }),
    ),
  );

  for (const owner of ['desktop-session-world', 'foreground', 'input-activity', 'chronicle']) {
    assert.equal(
      statements.some((statement) => statement.specifier.includes(owner)),
      false,
      `读取入口不应直接依赖 ${owner}`,
    );
  }

  // The Runtime is imported as a type and never as code, as in the sibling plugin.
  const runtimeImports = statements.filter((statement) => statement.specifier.includes('runtime/'));
  assert.deepEqual(runtimeImports.filter((statement) => !statement.text.startsWith('import type')), []);
});

test('没有任何一条路径能把正文写到磁盘上', () => {
  // The mandate's 不落盘保存真实正文, asserted structurally: the module has no write API to call, so
  // this is a fact about the code rather than a promise in a document. `src/cli/content.ts` is
  // included because a client that buffered a read into a file would be the same defect one layer out.
  const writeApis =
    /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|createWriteStreamSync|openSync|mkdirSync)\b/;
  const offenders = [
    ...sourceFiles(join(SRC, 'desktop-content-read')),
    join(SRC, 'cli', 'content.ts'),
    join(SRC, 'cli', 'content-command.ts'),
  ]
    .filter((file) => writeApis.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).replaceAll('\\', '/'));

  assert.deepEqual(offenders, []);
});

test('没有 Memory、Experience 或任何持续采集的入口', () => {
  const statements = sourceFiles(join(SRC, 'desktop-content-read')).flatMap((file) =>
    [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]),
  );

  for (const forbidden of ['memory', 'experience', 'chronicle']) {
    assert.equal(
      statements.some((specifier) => specifier.includes(forbidden)),
      false,
      `读取入口不应 import 与 ${forbidden} 有关的模块`,
    );
  }
});

test('客户端不触达常驻控制通道，也不知道 Awareness 契约', () => {
  for (const client of ['content.ts', 'content-command.ts']) {
    const source = readFileSync(join(SRC, 'cli', client), 'utf8');
    assert.doesNotMatch(source, /from '[^']*\/control\.js'/, `${client} 不应 import 控制通道`);
    assert.doesNotMatch(source, /\brequestControl\b/, `${client} 不应调用 requestControl`);
    assert.doesNotMatch(source, /\bdesktopSessionAwareness\w*Service\b/, `${client} 不应知道 Awareness 契约`);
  }
});

// ---------------------------------------------------------------------------------------------
// Three defects found by review, each pinned where it actually lives.
//
// All three have the same shape of history: a concrete failing scenario, no test that could have seen
// it, and a fix small enough to be more dangerous to leave out than to make. Two of them are in the
// shipped PowerShell and are therefore exercised here by running the shipped PowerShell text.
// ---------------------------------------------------------------------------------------------

test('端点自己写的失败行也要过终端边界，否则对端能借 Hikari 的嘴在终端上作画', { skip: NO_PIPES, timeout: 30_000 }, async (t) => {
  // The concrete failure. `serve` answers a refused request with a line built from `JSON.stringify` of
  // whatever the peer sent, and `JSON.stringify` escapes neither C1 controls nor U+2028 — so a peer on
  // this pipe can put a raw CSI and a line separator into a sentence Hikari is about to print as its
  // own. `renderContentRead` escapes everything it returns; this path escaped nothing.
  //
  // Threat model stated honestly: reaching it takes a process running as the same user, which the
  // endpoint's access boundary does not and is not asked to exclude. What the escaping buys is that
  // such a process cannot make the terminal *attribute* a forged line to Hikari.
  const root = createRoot(t);
  // Written as escapes, so this fixture cannot be mangled by an editor or a copy-paste into
  // something that no longer contains a control character at all — the same reason the escaping
  // test above says it out loud. U+009B is CSI; U+2028 is a line separator.
  const hostile = '\u009b2J\u009b1;1H伪造的 Hikari 行\u2028第二行';

  const server = createServer((socket) => {
    socket.on('data', () => {
      socket.end(`${encodeContentReadReply({ outcome: 'failed', lines: [hostile] })}\n`);
    });
  });
  await new Promise((ready) => server.listen(contentReadEndpointPath(root), ready));
  t.after(() => new Promise((done) => server.close(() => done())));

  // `spawn`, not `spawnSync`, and the reason is a trap rather than a preference: the endpoint this
  // test is talking to lives in *this* process, so a synchronous spawn would block the event loop that
  // has to answer it — the CLI would sit out its full 30-second reply bound and report no answer, which
  // is exactly the failure a reader would misdiagnose as a broken client.
  const result = await runCli(['content', 'status', '--data-dir', root]);

  assert.equal(result.status, 1);
  // The byte is still real and still carried — it is written out rather than acted on.
  assert.match(result.stderr, /\\u009b/);
  assert.match(result.stderr, /\\u2028/);
  assert.doesNotMatch(result.stderr, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/, '终端不应收到任何原始控制字符');
});

test('时间戳表达式在区域设置不是本机这一种时也必须成立，否则整个能力静默消失', { skip: NO_POWERSHELL }, () => {
  // The concrete failure, measured on this machine: in a .NET custom date format `:` is the *time
  // separator placeholder*, substituted with the running culture's separator. 24 of this machine's 915
  // cultures set it to `.`, and under any of them `ToString('yyyy-MM-ddTHH:mm:ss.fff')` returns
  // `2026-10-09T17.35.36.458Z`, which `UTC_TIMESTAMP` rejects. `readSample` then throws, `plugin.ts`
  // swallows it, no sample is ever held, and *every* read on that machine answers "没有可以归给人类的
  // 窗口" — with no error anywhere to explain it. The walk's own `$readAt` fails the same way.
  //
  // This test runs the exact call the shipped scripts make, taken out of the built artifacts, under an
  // explicitly hostile culture. It is a behavioural test of the artifact and not a copy of it: if the
  // expression changes in `src/`, the string under test changes with it.

  const call = /\[System\.DateTime\]::UtcNow\.ToString\(([^)]*)\)/;

  // The walk's timestamp moved with the walk: it is in `walk.ps1` now, and looking for it in `uia.js`
  // would be looking in a file that no longer has it.
  const carriers = [
    { module: 'walk.ps1', path: WALK_SCRIPT },
    { module: 'probe.js', path: join(import.meta.dirname, '..', 'dist', 'desktop-content-read', 'probe.js') },
  ];

  for (const { module, path } of carriers) {
    const source = readFileSync(path, 'utf8');
    const found = call.exec(source);
    assert.ok(found, `${module} 里应当有那一行时间戳`);
    assert.match(found[1], /InvariantCulture/, `${module} 的时间戳必须显式使用不变文化`);

    // Under fi-FI, as shipped: correct.
    assert.match(
      runPowershell(underCulture(found[1], 'fi-FI')),
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      `${module} 在 fi-FI 下应当仍产出可解析的时间戳`,
    );

    // And the counterfactual, so that this test is known to bite rather than assumed to: the same call
    // with the provider stripped fails exactly as the defect did.
    const withoutProvider = found[1].replace(/,\s*\[System\.Globalization\.CultureInfo\]::InvariantCulture/, '');
    assert.notEqual(withoutProvider, found[1], `${module} 的参数里应当有那个 provider 可供剥离`);
    assert.doesNotMatch(
      runPowershell(underCulture(withoutProvider, 'fi-FI')),
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      '去掉 provider 之后应当复现原来那个失败，否则这条测试并没有在测它',
    );
  }
});

test('字符预算用尽时不会留下一个没有节点的区域', { skip: NO_POWERSHELL }, () => {
  // The concrete failure. `Region-For` used to be evaluated as an *argument* to `Add-Node`, and
  // PowerShell evaluates arguments first — so a call the character budget then refused had already
  // registered a region. When one node filled the budget *exactly* and the next node opened a region
  // not yet seen, the walk stopped with `truncatedBy = 'chars'` and emitted that empty region;
  // `readRegion` rejects a region with no nodes, so the whole read came back `failed` instead. The
  // answer owed was `truncated`.
  //
  // It was intermittent (the budget must land exactly and the next element must open a new region) and
  // unreachable from the rest of this file, which injects its walker. So this test takes the shipped
  // script's own `Stop-With` / `Region-For` / `Add-Node` — consecutive in the script, so the slice is a
  // unit — and drives them directly with a budget of five characters.

  const script = walkScript();
  const from = script.indexOf('function Stop-With');
  const to = script.indexOf('function Rect-Of');
  assert.ok(from > 0 && to > from, '遍历脚本里应当有连续的 Stop-With / Region-For / Add-Node');

  const driver = [
    '$MaxChars = 5',
    '$script:counted = [ordered]@{ truncatedBy = $null; scanned = 0; matched = 0; textChars = 0 }',
    '$script:stopped = $false',
    '$script:regions = [ordered]@{}',
    '$script:order = New-Object System.Collections.ArrayList',
    script.slice(from, to),
    // The first node fills the budget exactly, without truncation and therefore without stopping.
    "$first = Add-Node 'frameA' 'inside' $null 'abcde' 'name' 0",
    // The second is one character that no longer fits, and it opens a region not seen before.
    "$second = Add-Node 'frameB' 'inside' $null 'x' 'name' 0",
    '[ordered]@{',
    '  first = $first',
    '  second = $second',
    '  truncatedBy = $script:counted.truncatedBy',
    '  keyCount = @($script:order).Count',
    '  firstKey = if (@($script:order).Count -gt 0) { $script:order[0] } else { "" }',
    '  nodeCounts = (@($script:order | ForEach-Object { $script:regions[$_].nodes.Count }) -join ",")',
    '} | ConvertTo-Json -Compress',
  ].join('\n');

  const result = runPowershell(driver);
  const observed = JSON.parse(result);

  assert.equal(observed.first, true, '第一个节点应当被接受');
  assert.equal(observed.second, false, '预算用尽后的节点应当被拒绝');
  assert.equal(observed.truncatedBy, 'chars');
  // The whole point: no region was registered for the refused node. Under the old ordering `frameB`
  // would be here with no nodes, and `readRegion` would have turned the read into `failed`.
  assert.equal(observed.keyCount, 1);
  assert.equal(observed.firstKey, 'frameA|inside|');
  assert.equal(observed.nodeCounts, '1');
});

/**
 * The walk script as it ships.
 *
 * Taken from `dist/` rather than from `src/` or from this file's own copy of the text, so that what
 * is exercised is the artifact the resident actually runs and not a paraphrase of it.
 */
function walkScript() {
  return readFileSync(WALK_SCRIPT, 'utf8');
}

/**
 * The real CLI as a real process, awaited rather than blocked on.
 *
 * Every other test that runs this binary uses `spawnSync`, which is correct where nothing in this
 * process has to answer it. This one is the exception: the endpoint stands in the same event loop, so a
 * synchronous spawn deadlocks the test against itself and the symptom is the client's own timeout.
 */
function runCli(args) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', fail);
    child.on('close', (status) => settle({ status, stdout, stderr }));
  });
}

/** Runs a script through the same transport the production code uses, and returns its stdout. */
function runPowershell(source) {
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.error, undefined, `PowerShell 未能启动：${result.error?.message}`);
  assert.equal(result.status, 0, `PowerShell 退出码 ${result.status}：${result.stderr}`);
  return result.stdout.trim();
}

/**
 * The shipped walk script, run the way production runs it, at bounds this file names.
 *
 * `uia.ts` always passes `READ_MAX_DEPTH`; the depth test below needs a smaller one and would otherwise
 * have to reach through the module to get it. The eight arguments are the same eight, in the same order,
 * because this is meant to be the production call with one number changed.
 */
function walkViaFile(scriptPath, { handle, expectedPid = 0, maxDepth, maxNodes = 2000, maxChars = 40_000 }) {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      scriptPath,
      '-Handle', String(handle),
      '-ExpectedPid', String(expectedPid),
      '-MaxDepth', String(maxDepth),
      '-MaxNodes', String(maxNodes),
      '-MaxChars', String(maxChars),
      '-EdgeTolerance', '1',
      '-ClientAreaId', 'window-client-area',
      '-UnidentifiedId', 'scroll-container',
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.error, undefined, `遍历脚本未能启动：${result.error?.message}`);
  assert.equal(result.status, 0, `遍历脚本退出码 ${result.status}：${result.stderr}`);
  return JSON.parse(result.stdout);
}

/** Every text the walk kept, across every region. */
function walkedTexts(walk) {
  return walk.regions.flatMap((region) => region.nodes.map((node) => node.text));
}

/** The shipped call, run with the culture set to a hostile one. */
function underCulture(arguments_, culture) {
  return [
    `[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::GetCultureInfo('${culture}')`,
    `[System.DateTime]::UtcNow.ToString(${arguments_}) + 'Z'`,
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// How the walk script reaches PowerShell.
//
// This is the half of the transport question that is not about any one script's size: the walk was
// moved off the command line because its text measured 31,870 characters against a 32,767-character
// CreateProcess limit, and the failure at that size is `spawn ENAMETOOLONG`, whose message names
// neither the script nor its length. The two tests below pin the property that made the failure
// unreachable rather than pinning the number that happened to be measured.
// ---------------------------------------------------------------------------------------------

test('遍历脚本随包发布、自己接参数、是纯 ASCII，而且正文不再出现在编译产物里', () => {
  // The ASCII rule is not a style preference. PowerShell reads a `.ps1` with no byte-order mark through
  // the system ANSI code page — 936 on the machine this was written on — so a UTF-8 character in the
  // file is decoded into something else. Measured here before the rule was written down: a UTF-8
  // character inside a string literal made the parser report a missing string terminator and exit 1,
  // because the decoded bytes swallowed the closing quote; the same character in a comment survived.
  // A byte-order mark would also work and is one editor setting away from being dropped, after which
  // the file is silently wrong. Pure ASCII has no such setting.
  const script = walkScript();
  assert.ok(script.length > 10_000, `随包发布的应当是遍历脚本本身，实际只有 ${script.length} 字节`);
  assert.doesNotMatch(script, /[^\x00-\x7f]/, '遍历脚本必须是纯 ASCII');

  // Its first line of *code* is `param(` — the script binds its own arguments rather than having them
  // interpolated into it. Read after the comments are stripped, because the header is the longest part
  // of the file and would otherwise be the thing this assertion measured.
  const firstCodeLine = stripPowerShellComments(script).trim().split('\n')[0].trim();
  assert.equal(firstCodeLine, 'param(', '遍历脚本的第一行代码应当自己接参数，而不是被拼进命令行');

  // And no part of it is still inside the module. Checked by looking for the script's own identifiers
  // in the compiled code rather than by comparing lengths: any line of the walk reappearing in
  // `uia.js` would mean the transport had gone back, whatever the file sizes said.
  const module = codeOnly(readFileSync(join(import.meta.dirname, '..', 'dist', 'desktop-content-read', 'uia.js'), 'utf8'));
  for (const name of ['Add-Node', 'Region-For', 'GetWindowThreadProcessId', 'ConvertTo-Json', 'Stop-With']) {
    assert.doesNotMatch(module, new RegExp(name), `遍历脚本的 ${name} 不应出现在 uia.js 的代码里`);
  }
  assert.match(module, /'-File'/, '遍历脚本应当以 -File 交给 PowerShell');
  assert.doesNotMatch(module, /-EncodedCommand/, '遍历脚本不应再走 -EncodedCommand');
});

test('脚本再长也不进命令行：加长后的脚本仍然跑得起来，而同样的正文走 -EncodedCommand 根本起不来', { skip: NO_POWERSHELL, timeout: 120_000 }, (t) => {
  // The right way, with the script padded far past anything a command line could carry. It is the real
  // script plus comment, so the walk still runs — the point is that its *length* no longer reaches the
  // operating system.
  const padded = join(createRoot(t), 'walk-padded.ps1');
  const body = `${walkScript()}\n${'# padding to make the command line impossible\n'.repeat(600)}`;
  writeFileSync(padded, body, 'utf8');
  assert.ok(body.length > 30_000, `加长后的脚本应当远超命令行能承载的长度，实际 ${body.length}`);

  // No window: the walk stops at its first guard and says so, which is all this test needs from it.
  const viaFile = walkViaFile(padded, { handle: 1, maxDepth: 32 });

  // The walk really ran — it reached the guard, which is only reachable after `param()` bound and
  // `Add-Type` compiled. A script that had silently failed to load would produce no JSON at all.
  assert.deepEqual(viaFile, { ok: false, reason: 'window-gone' });

  // The counterfactual, on the same text. `-EncodedCommand` carries base64 of UTF-16LE, so it pays
  // twice for every character, and the same script cannot be handed over at all: the failure is in the
  // operating system's process creation, before PowerShell is running. This is the failure mode the
  // move removed, and asserting it here is what keeps the reason for the move from being a story.
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  assert.ok(encoded.length > 32_767, `base64 正文应当已经越过 CreateProcess 的 32767 上限，实际 ${encoded.length}`);

  const viaCommandLine = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.notEqual(viaCommandLine.status, 0, '同样长度的正文走 -EncodedCommand 不应该还能起得来');
  assert.match(
    String(viaCommandLine.error?.code ?? ''),
    /ENAMETOOLONG/,
    `期望进程创建本身失败，实际：${viaCommandLine.error?.message ?? `退出码 ${viaCommandLine.status}`}`,
  );
});

// ---------------------------------------------------------------------------------------------
// The whole chain, against a window that really exists.
//
// Everything above this point either injects its walker or runs the script against a handle that is
// not a window. That leaves the one claim the surface is actually for unexercised: that a window
// someone is reading can be read back. These two tests close it, and they need a window that
// PowerShell did not create — see `SYNTHETIC_WINDOW` below for why.
// ---------------------------------------------------------------------------------------------

const NO_DESKTOP = process.platform === 'win32' ? false : '合成窗口需要一个 Windows 桌面';

// A WPF window, compiled here rather than checked in, and compiled *rather than scripted* for a reason
// that comes from this repository's own rules: a window hosted by `powershell.exe` is inadmissible,
// because `powershell` is in `HIKARI_SURFACE_PROCESS_NAMES`. Hikari's own surfaces are terminals, and
// reading the terminal Hikari prints into would be reading its own output back. A window shown from a
// PowerShell script would therefore be refused at the front door and could never reach the walk — the
// tests would pass while exercising nothing.
//
// An exe of our own compiles in about 400 ms through `Add-Type -OutputAssembly` and has a process name
// that is not on that list, so admissibility is exercised rather than assumed. The window writes the
// handle it was given by Windows, and the process id it is actually running as, to a file it is told
// about; nothing about either value is chosen by the test.
//
// Two shapes, and the second one exists for the depth bound. `deep` puts a twelve-deep chain of buttons
// as the *first* child of the root panel, with a plain text element after it at the same shallow depth
// as one before it. That is the smallest window that can tell the walk's global truncation apart from
// per-branch pruning: at a depth bound that the chain crosses, a pruning walk would still reach the
// element after it, and a stopping walk would not.
const SYNTHETIC_WINDOW = [
  'using System;',
  'using System.IO;',
  'using System.Windows;',
  'using System.Windows.Controls;',
  '',
  'public class HikariE2eWindow',
  '{',
  '    [STAThread]',
  '    public static void Main(string[] args)',
  '    {',
  '        string readyPath = args[0];',
  '        string marker = args[1];',
  '        string shape = args.Length > 2 ? args[2] : "flat";',
  '        var app = new Application();',
  '        var window = new Window();',
  '        window.Title = "Hikari E2E Window";',
  '        window.Width = 720;',
  '        window.Height = 420;',
  '        var stack = new StackPanel();',
  '        if (shape == "deep")',
  '        {',
  '            stack.Children.Add(new TextBlock { Text = "BEFORE-DEEP" });',
  '            var head = new Button { Content = "level" };',
  '            var current = head;',
  '            for (int i = 0; i < 12; i++)',
  '            {',
  '                var next = new Button { Content = "level" };',
  '                current.Content = next;',
  '                current = next;',
  '            }',
  '            stack.Children.Add(head);',
  '            stack.Children.Add(new TextBlock { Text = "SHALLOW-SIBLING" });',
  '        }',
  '        else',
  '        {',
  '            stack.Children.Add(new TextBlock { Text = marker });',
  '            stack.Children.Add(new TextBox { Text = marker + " textbox", IsReadOnly = true });',
  '        }',
  '        window.Content = stack;',
  '        window.Show();',
  '        IntPtr handle = new System.Windows.Interop.WindowInteropHelper(window).Handle;',
  '        File.WriteAllText(readyPath, "{\\"handle\\":" + handle.ToInt64()',
  '            + ",\\"processId\\":" + System.Diagnostics.Process.GetCurrentProcess().Id + "}");',
  '        app.Run();',
  '    }',
  '}',
].join('\n');

function buildSyntheticWindow(root) {
  const executable = join(root, 'HikariE2eWindow.exe');
  runPowershell(
    [
      "$source = @'",
      SYNTHETIC_WINDOW,
      "'@",
      `Add-Type -TypeDefinition $source -OutputAssembly '${executable}' -OutputType WindowsApplication -ReferencedAssemblies PresentationFramework, PresentationCore, WindowsBase, System.Xaml`,
    ].join('\n'),
  );
  assert.ok(existsSync(executable), '合成窗口应当已经被编译出来');
  return executable;
}

/**
 * A synthetic WPF window, and the temporary directory its executable was compiled into.
 *
 * The directory belongs to this helper rather than to `createRoot`, and that is not tidiness. A
 * directory cannot be removed on Windows while an executable inside it is running, and `t.after` hooks
 * run in the order they were registered — so with `createRoot` called first, a test that *failed*
 * before its own `close()` ran the removal hook while the window was still alive, and the removal never
 * returned. The suite did not go red; it hung, printed nothing, and left the window running.
 *
 * Measured with an isolated probe rather than reasoned about: the removal hook printed that it had
 * started and never printed that it had finished, the kill hook registered after it never ran at all,
 * and the process sat there until it was killed by a timeout.
 *
 * That ownership change removes a real hazard and it did *not* stop the suite hanging, which is worth
 * saying because it was believed to for a while. The hang had a second and independent cause — the
 * `exitCode`-only guard in `stop()` below — and finding it took tracing the teardown rather than
 * reordering it: the test body ran its every assertion to completion in about 2.2 s and the process
 * then sat there until its timeout. Both fixes are here; neither implies the other.
 */
async function openSyntheticWindow(t, marker, shape = 'flat') {
  const root = mkdtempSync(join(tmpdir(), 'hikari-content-window-'));
  const executable = buildSyntheticWindow(root);
  const readyPath = `${executable}.ready`;
  const child = spawn(executable, [readyPath, marker, shape], { stdio: 'ignore' });

  const stop = async () => {
    // "Already gone" is `exitCode !== null || signalCode !== null`, and the second half is not
    // decoration. A child killed by a signal leaves `exitCode` null and `signalCode` set, so a guard
    // that reads only `exitCode` treats a dead window as a live one, calls `kill()` on it, and then
    // waits for an `exit` that has already been emitted — forever, because a ChildProcess emits `exit`
    // once. Measured rather than reasoned about: `close()` kills the window with SIGTERM, the test body
    // then finishes and its after-hook calls this a second time, and the suite hung for the full 100 s
    // budget with the window process already gone and nothing else open. The walker's own `terminate`
    // in `uia.ts` guards on both fields; this helper guarded on one.
    //
    // Nothing can slip in between the check and the listener either: there is no `await` in between, so
    // an exit cannot land in the gap.
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await once(child, 'exit');
  };

  t.after(async () => {
    await stop();
    rmSync(root, { recursive: true, force: true });
  });

  const deadline = Date.now() + 30_000;
  while (!existsSync(readyPath)) {
    if (Date.now() > deadline) throw new Error('合成窗口始终没有报到');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
  assert.ok(Number.isSafeInteger(ready.handle) && ready.handle > 0, `合成窗口句柄不可用：${ready.handle}`);
  assert.ok(Number.isSafeInteger(ready.processId) && ready.processId > 0, `合成窗口进程不可用：${ready.processId}`);

  return {
    handle: ready.handle,
    processId: ready.processId,
    title: 'Hikari E2E Window',
    processName: 'HikariE2eWindow',
    observedAt: new Date().toISOString(),
    async close() {
      await stop();
      // The window is destroyed as part of process teardown, and an earlier measurement at this same
      // site settled for 1500 ms. This one settles shorter, which is the safe direction: a window that
      // somehow outlived its process would make the read succeed and the assertion below go red, rather
      // than making a genuine failure look like a pass.
      await new Promise((resolve) => setTimeout(resolve, 500));
    },
  };
}

test('合成 WPF 窗口：真实遍历脚本把窗口正文读了回来，句柄失效与换主都判 unreadable', { skip: NO_DESKTOP, timeout: 120_000 }, async (t) => {
  const marker = `HIKARI-E2E-${process.pid}`;
  const window = await openSyntheticWindow(t, marker);

  const walker = createWindowsWalker();
  t.after(() => walker.dispose());

  const walk = await walker.walk(window);
  assert.equal(walk.kind, 'walked', `真实窗口没有走通：${walk.reason ?? walk.readAt}`);

  // The marker was chosen by this test, put on the window by the window, and read back through the
  // channels UI Automation exposes. Nothing between the two is this repository's.
  const texts = walkedTexts(walk);
  assert.ok(texts.includes(marker), `遍历结果里没有合成窗口的标记：${JSON.stringify(texts)}`);
  assert.ok(
    texts.includes(`${marker} textbox`),
    `文本框里的标记没有读回来，value 通道可能断了：${JSON.stringify(texts)}`,
  );
  assert.ok(walk.counted.scanned > 0 && walk.counted.matched > 0, `计数不合理：${JSON.stringify(walk.counted)}`);
  assert.ok(walk.regions.length > 0, '一个真实窗口应当至少有一个区域');

  // A handle whose owner is not the process the sample named. This is what a handle that Windows has
  // since reused for someone else's window looks like from here, and it is the case §3.4's second
  // guard exists for: the handle is still a window, so the first guard passes.
  const replaced = await walker.walk({ ...window, processId: window.processId + 1 });
  assert.equal(replaced.kind, 'unreadable');
  assert.equal(replaced.reason, '那个句柄指向的已经不是同一次观测到的窗口。');

  // And the window genuinely gone. Same sample, taken while it was alive; the read happens after.
  await window.close();

  const gone = await walker.walk(window);
  assert.equal(gone.kind, 'unreadable', `窗口已经不在了，却读到了：${JSON.stringify(gone).slice(0, 200)}`);
  assert.equal(gone.reason, '目标窗口在读取期间已经不存在了。');
});

test('深度上限是整次遍历就此停止，不是剪掉够深的那一条分支', { skip: NO_DESKTOP, timeout: 120_000 }, async (t) => {
  // F2 of the implementation mandate accepted the current global semantics and asked that the docs, the
  // results and the tests agree about them. The first two are sentences; this is the third, and it is a
  // failing scenario rather than a restatement — the two semantics differ on exactly one window shape,
  // and this is that shape.
  //
  // The shape: a root panel whose first child is a twelve-deep chain of buttons, with a plain text
  // element on either side of it at the same shallow depth. A walk that stops when it reaches the bound
  // never comes back out to read the element *after* the chain; a walk that prunes only the branch that
  // reached the bound reads it. Both runs use the shipped script, the real window, and the production
  // argument list — only the depth number differs.
  const window = await openSyntheticWindow(t, 'unused-in-this-shape', 'deep');

  const full = walkViaFile(WALK_SCRIPT, {
    handle: window.handle,
    expectedPid: window.processId,
    maxDepth: READ_MAX_DEPTH,
  });
  assert.equal(full.ok, true, JSON.stringify(full).slice(0, 200));
  const fullTexts = walkedTexts(full);
  // Both are there when nothing truncates, which is what makes their disappearance below mean something.
  assert.ok(fullTexts.includes('BEFORE-DEEP'), `未截断时应当读到深链之前的元素：${JSON.stringify(fullTexts)}`);
  assert.ok(fullTexts.includes('SHALLOW-SIBLING'), `未截断时应当读到深链之后的元素：${JSON.stringify(fullTexts)}`);
  assert.equal(full.bounds.truncatedBy, null, '32 层应当足以走完这个窗口');

  // Six, because the chain is twelve deep and the two markers are two or three deep: the bound is
  // crossed inside the chain, well past the first marker and well before the second.
  const shallow = walkViaFile(WALK_SCRIPT, {
    handle: window.handle,
    expectedPid: window.processId,
    maxDepth: 6,
  });
  assert.equal(shallow.bounds.truncatedBy, 'depth');

  const shallowTexts = walkedTexts(shallow);
  assert.ok(
    shallowTexts.includes('BEFORE-DEEP'),
    `停止之前的同级元素应当已经读到：${JSON.stringify(shallowTexts)}`,
  );
  assert.ok(
    !shallowTexts.includes('SHALLOW-SIBLING'),
    `停止之后尚未访问的同级元素也不应出现 —— 这是整次遍历停止，不是分支剪枝：${JSON.stringify(shallowTexts)}`,
  );

  await window.close();
});

test('合成 WPF 窗口的完整链：从命名管道问一句，回来的是那个窗口此刻的正文', { skip: NO_DESKTOP, timeout: 120_000 }, async (t) => {
  // The one test in this file where every part is real. The occurrence comes from a plugin, the sample
  // comes from an injected probe standing in for the PowerShell probe, admissibility is the shipped
  // rule, the walk is the shipped script against a window that exists, the rendering is the shipped
  // rendering, and the answer travels a real named pipe to the real client.
  //
  // The probe is injected because the shipped one reads the *foreground* window, and a background test
  // process cannot make a window foreground — that hop needs a person, and it is recorded as uncovered
  // rather than simulated. Everything the probe's output feeds into is the real thing.
  const marker = `HIKARI-E2E-CHAIN-${process.pid}`;
  const window = await openSyntheticWindow(t, marker);
  const observedAt = window.observedAt;

  const composed = await composeWith(t, () => fakeProbe({ ...window }), createWindowsWalker);
  await composed.observe();

  const answer = await requestDesktopContentRead(composed.root);
  assert.equal(answer.kind, 'answered');
  assert.equal(answer.reply.outcome, 'ok', answer.reply.lines.join('\n'));

  const text = answer.reply.lines.join('\n');
  assert.match(text, /结果：read/);
  assert.match(text, new RegExp(marker), '答案里没有那个窗口的正文');

  // The identity the answer carries is the one that was observed, handle and time both. The time is
  // the part that matters for §3.4: a read is addressed to a window *as of an observation*, and the
  // answer has to say which observation it was answered against.
  const renderedHandle = `0x${window.handle.toString(16).toUpperCase().padStart(16, '0')}`;
  assert.ok(text.includes(`窗口句柄：${renderedHandle}`), `答案里的句柄不是被观测的那个：${text}`);
  assert.ok(text.includes(`窗口观测时间：${observedAt}`), '答案里的观测时间不是被观测的那一刻');
  assert.ok(text.includes('窗口标题：Hikari E2E Window'), '答案里的窗口标题不对');

  await window.close();
});

test('合成窗口的进程名不在 Hikari 自己的界面清单里，所以它进得来；同样的样本换成 powershell 就进不来', () => {
  // The seam the two tests above depend on, asserted directly so that a future change to
  // `HIKARI_SURFACE_PROCESS_NAMES` cannot quietly turn them into tests of nothing. Both directions,
  // because only the pair shows that admissibility is doing the work.
  assert.equal(isAdmissibleSample({ handle: 1, title: 'x', processName: 'HikariE2eWindow', processId: 1, observedAt: OBSERVED_AT }), true);
  assert.equal(isAdmissibleSample({ handle: 1, title: 'x', processName: 'powershell', processId: 1, observedAt: OBSERVED_AT }), false);
});
