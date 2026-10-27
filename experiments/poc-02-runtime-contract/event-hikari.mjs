// PoC-02 / s2：在 Hikari 原 Runtime 下测真实事件 desktop-session-awareness-loop.assessed@1 的五项语义。
//
// 主体是产品代码：四层桌面感知 + 真实的 desktop-session-awareness-loop 插件（它自己 await emit）。
// 唯一自己写的是「隔离测试订阅者」——它不是生产消费者（生产消费者只有 desktop-content-read），
// 只用来观察事件什么时候到、到了几个、能不能等到。
//
// 运行：node experiments/poc-02-runtime-contract/event-hikari.mjs
// 依赖：hikari-new 已 `npm run build`（从 dist/ 导入，与产品同一份代码）

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;

const foreground = await import(HIKARI('foreground/index.js'));
const inputActivity = await import(HIKARI('input-activity/index.js'));
const world = await import(HIKARI('desktop-session-world/index.js'));
const awareness = await import(HIKARI('desktop-session-awareness/index.js'));
const loop = await import(HIKARI('desktop-session-awareness-loop/index.js'));
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const { EventBus } = await import(HIKARI('runtime/event-bus.js'));

const EVENT = loop.desktopSessionAwarenessAssessedEvent;
const DELAY_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LAYERS = [
  foreground.foregroundPlugin,
  inputActivity.inputActivityPlugin,
  world.desktopSessionWorldPlugin,
  awareness.desktopSessionAwarenessPlugin,
];

/** 隔离测试订阅者：只观察，不参与产品行为。 */
function makeProbe(id, handlers) {
  return {
    id,
    version: '1.0.0',
    requires: [],
    provides: [],
    setup(context) {
      for (const handler of handlers) context.events.on(EVENT, handler);
    },
  };
}

/** 等第 n 个事件到达；超时返回 null。 */
function collect(expected, timeoutMs) {
  const arrivals = [];
  let resolveAll;
  const done = new Promise((r) => (resolveAll = r));
  const timer = setTimeout(() => resolveAll(null), timeoutMs);
  const handler = () => {
    arrivals.push({ at: performance.now(), payload: undefined });
    if (arrivals.length >= expected) {
      clearTimeout(timer);
      resolveAll(arrivals);
    }
  };
  return { handler, done };
}

async function freshRuntime(extra = []) {
  const runtime = new Runtime();
  for (const def of [...LAYERS, ...extra]) await runtime.loadPlugin(def);
  return runtime;
}

const results = { event: `${EVENT.id}@${EVENT.version}`, delayMs: DELAY_MS, checks: {} };

// ── E1：发布是否等待订阅者 ────────────────────────────────────────────────
// 探针睡 300 ms。若 emit 真的等，相邻两个事件的间隔 ≥ 300 + delayMs；若不等，间隔 ≈ delayMs。
{
  const arrivals = [];
  const slow = makeProbe('poc02-slow', [
    async () => {
      arrivals.push(performance.now());
      await sleep(300);
    },
  ]);
  const runtime = new Runtime();
  for (const def of LAYERS) await runtime.loadPlugin(def);
  await runtime.loadPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: DELAY_MS });
  await runtime.loadPlugin(slow);

  await sleep(300 + DELAY_MS * 4);
  const before = arrivals.length;
  await sleep(1400);
  const gaps = [];
  for (let i = 1; i < arrivals.length; i += 1) gaps.push(Math.round(arrivals[i] - arrivals[i - 1]));
  results.checks.waitsForSubscribers = {
    subscriberSleepMs: 300,
    delayMs: DELAY_MS,
    arrivalsBefore: before,
    arrivalsTotal: arrivals.length,
    gapsMs: gaps,
    verdict: gaps.length === 0 ? 'no-arrival' : gaps.every((g) => g >= 300) ? 'waits' : 'does-not-wait',
    expect: '≥ 300+delayMs 说明发布方等订阅者；≈ delayMs 说明不等',
  };
  await runtime.shutdown();
}

// ── E2：多异步订阅者并发 ──────────────────────────────────────────────────
{
  const windows = [];
  const mk = (tag) => async () => {
    const start = performance.now();
    await sleep(300);
    windows.push({ tag, start, end: performance.now() });
  };
  const runtime = new Runtime();
  for (const def of LAYERS) await runtime.loadPlugin(def);
  await runtime.loadPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: 10_000 });
  await runtime.loadPlugin(makeProbe('poc02-two-a', [mk('a')]));
  await runtime.loadPlugin(makeProbe('poc02-two-b', [mk('b')]));

  await sleep(1200);
  const pair = windows.slice(0, 2);
  const concurrent = pair.length === 2 && Math.abs(pair[0].start - pair[1].start) < 60;
  const spanMs = pair.length === 2 ? Math.round(Math.max(...pair.map((w) => w.end)) - Math.min(...pair.map((w) => w.start))) : null;
  results.checks.parallelSubscribers = {
    subscribers: pair.map((w) => w.tag),
    startDeltaMs: pair.length === 2 ? Math.round(Math.abs(pair[0].start - pair[1].start)) : null,
    spanMs,
    verdict: pair.length < 2 ? 'not-both-called' : concurrent && spanMs < 600 ? 'concurrent' : 'serial',
    expect: '两个 start 几乎同时且总跨度 ≈ 300 说明并发；≈ 600 说明串行',
  };
  await runtime.shutdown();
}

// ── E3：订阅者抛错是否聚合为 AggregateError（且消息含事件名） ─────────────
// 真实插件把 `await emit` 包在 try/catch 里（plugin.ts:86-95），所以经由插件的路径看不到错误；
// 这里直接对真实 EventBus 发一次事件，暴露运行时本身的聚合语义。
{
  const bus = new EventBus();
  const a = bus.subscribe(EVENT, 'probe-a', async () => {
    throw new Error('boom-a');
  });
  const b = bus.subscribe(EVENT, 'probe-b', async () => {
    throw new Error('boom-b');
  });
  let captured = null;
  try {
    await bus.emit(EVENT, { at: 'now' });
  } catch (error) {
    captured = error;
  }
  a();
  b();
  results.checks.failureAggregation = {
    thrownType: captured?.constructor?.name ?? null,
    message: captured?.message ?? null,
    reasons: captured?.errors?.map((e) => e.message) ?? [],
    verdict: captured instanceof AggregateError ? 'aggregated' : 'not-aggregated',
    note: '直接对真实 EventBus 发起；经插件的路径会把错误吞在 plugin.ts:86-95 的 catch 里',
  };
}

// ── E4 + E5：卸载退订 / 重新装载恢复 ──────────────────────────────────────
{
  let hits = 0;
  const runtime = new Runtime();
  for (const def of LAYERS) await runtime.loadPlugin(def);
  await runtime.loadPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: DELAY_MS });
  await runtime.loadPlugin(makeProbe('poc02-lifecycle', [() => { hits += 1; }]));

  await sleep(450);
  const afterLoad = hits;

  await runtime.unloadPlugin('poc02-lifecycle');
  await sleep(150);
  const atUnload = hits;
  await sleep(450);
  const afterUnload = hits - atUnload;

  await runtime.loadPlugin(makeProbe('poc02-lifecycle', [() => { hits += 1; }]));
  await sleep(450);
  const afterReload = hits - atUnload;

  results.checks.unsubscribeAndReactivate = {
    hitsWhileLoaded: afterLoad,
    hitsInFirst450msAfterUnload: afterUnload,
    hitsAfterReload: afterReload,
    verdict: afterLoad > 0 && afterUnload === 0 && afterReload > 0 ? 'unsubscribe-then-resubscribe' : 'unexpected',
    expect: '装载期收到 >0；卸载后 450 ms 内 0；重装后又 >0',
  };
  await runtime.shutdown();
}

writeFileSync(resolve(here, 'event-hikari.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
