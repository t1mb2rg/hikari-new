// PoC-02 / s3：同一组五项语义，在 Cordis 宿主下测一遍，逐项与 s2 的 Hikari 读数对照。
//
// 主体仍是产品代码：四层桌面感知 + 真实的 desktop-session-awareness-loop 插件（它自己 await emit）。
// 唯一自己写的是适配层（adapter-events.mjs）与隔离测试订阅者（不是生产消费者）。
//
// 运行：node experiments/poc-02-runtime-contract/event-cordis.mjs
// 依赖：hikari-new 已 `npm run build`；DSH 已安装在 DSH_ROOT。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { toCordisPlugin, eventName } from './adapter-events.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);

const foreground = await import(HIKARI('foreground/index.js'));
const inputActivity = await import(HIKARI('input-activity/index.js'));
const world = await import(HIKARI('desktop-session-world/index.js'));
const awareness = await import(HIKARI('desktop-session-awareness/index.js'));
const loop = await import(HIKARI('desktop-session-awareness-loop/index.js'));

const EVENT = loop.desktopSessionAwarenessAssessedEvent;
const NAME = eventName(EVENT);
const DELAY_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LAYERS = [
  foreground.foregroundPlugin,
  inputActivity.inputActivityPlugin,
  world.desktopSessionWorldPlugin,
  awareness.desktopSessionAwarenessPlugin,
];

const results = { event: NAME, delayMs: DELAY_MS, checks: {} };

function bootLayers(root) {
  const fibers = {};
  for (const def of LAYERS) {
    const { plugin } = toCordisPlugin(def);
    fibers[def.id] = root.plugin(plugin);
  }
  return fibers;
}

// ── C1：发布是否等待订阅者（对照 s2 E1） ────────────────────────────────
{
  const root = new Context();
  bootLayers(root);
  const { plugin } = toCordisPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: DELAY_MS });
  root.plugin(plugin);

  const arrivals = [];
  root.plugin((ctx) => {
    ctx.on(NAME, async () => {
      arrivals.push(performance.now());
      await sleep(300);
    });
  });

  await sleep(300 + DELAY_MS * 4);
  await sleep(1400);
  const gaps = [];
  for (let i = 1; i < arrivals.length; i += 1) gaps.push(Math.round(arrivals[i] - arrivals[i - 1]));
  results.checks.waitsForSubscribers = {
    subscriberSleepMs: 300,
    delayMs: DELAY_MS,
    arrivalsTotal: arrivals.length,
    gapsMs: gaps,
    verdict: gaps.length === 0 ? 'no-arrival' : gaps.every((g) => g >= 300) ? 'waits' : 'does-not-wait',
    mapping: 'events.emit → ctx.parallel',
  };
  await root.fiber.dispose();
}

// ── C2：多异步订阅者并发（对照 s2 E2） ──────────────────────────────────
{
  const root = new Context();
  bootLayers(root);
  const { plugin } = toCordisPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: 10_000 });
  root.plugin(plugin);

  const windows = [];
  const mk = (tag) => async () => {
    const start = performance.now();
    await sleep(300);
    windows.push({ tag, start, end: performance.now() });
  };
  root.plugin((ctx) => {
    ctx.on(NAME, mk('a'));
  });
  root.plugin((ctx) => {
    ctx.on(NAME, mk('b'));
  });

  await sleep(1400);
  const pair = windows.slice(0, 2);
  const delta = pair.length === 2 ? Math.round(Math.abs(pair[0].start - pair[1].start)) : null;
  const spanMs = pair.length === 2 ? Math.round(Math.max(...pair.map((w) => w.end)) - Math.min(...pair.map((w) => w.start))) : null;
  results.checks.parallelSubscribers = {
    subscribers: pair.map((w) => w.tag),
    startDeltaMs: delta,
    spanMs,
    verdict: pair.length < 2 ? 'not-both-called' : delta < 60 && spanMs < 600 ? 'concurrent' : 'serial',
  };
  await root.fiber.dispose();
}

// ── C3：失败聚合（对照 s2 E3） ──────────────────────────────────────────
{
  const root = new Context();
  root.plugin((ctx) => {
    ctx.on(NAME, async () => {
      throw new Error('boom-a');
    });
    ctx.on(NAME, async () => {
      throw new Error('boom-b');
    });
  });
  await sleep(50);

  let raw = null;
  try {
    await root.parallel(NAME, {});
  } catch (error) {
    raw = error;
  }

  // 适配层补 message 之后的样子（同一份 catch 逻辑，脱离宿主调用）
  let adapted = null;
  try {
    await root.parallel(NAME, {});
  } catch (error) {
    if (error instanceof AggregateError) {
      adapted = new AggregateError(error.errors, `Event ${NAME} had failing subscribers.`);
    } else {
      adapted = error;
    }
  }

  // 插件 setup 内 emit 失败时，Cordis 把错误放在哪里
  const { plugin: emitter } = toCordisPlugin({
    id: 'poc02-emitter',
    version: '1.0.0',
    requires: [],
    provides: [],
    async setup(context) {
      await context.events.emit(EVENT, {});
    },
  });
  const emitterFiber = root.plugin(emitter);
  await sleep(150);

  results.checks.failureAggregation = {
    rawParallel: {
      thrownType: raw?.constructor?.name ?? null,
      message: raw?.message ?? null,
      reasons: raw?.errors?.map((e) => e.message) ?? [],
    },
    adaptedEmit: {
      thrownType: adapted?.constructor?.name ?? null,
      message: adapted?.message ?? null,
      reasons: adapted?.errors?.map((e) => e.message) ?? [],
    },
    pluginSetupFailure: {
      fiberState: emitterFiber.state,
      fiberError: emitterFiber.error?.message ?? null,
      threwToCaller: false,
    },
    verdict: raw instanceof AggregateError ? 'aggregated' : 'not-aggregated',
    note: 'raw 是 ctx.parallel 原样抛出的；adapted 是 adapter-events.mjs 补了 message 之后的；pluginSetupFailure 看插件内 emit 失败时错误去哪了',
  };
  await root.fiber.dispose();
}

// ── C4 + C5：卸载退订 / 重新装载（对照 s2 E4/E5） ────────────────────────
{
  const root = new Context();
  bootLayers(root);
  const { plugin } = toCordisPlugin(loop.desktopSessionAwarenessLoopPlugin, { delayMs: DELAY_MS });
  root.plugin(plugin);

  let hits = 0;
  const probeFiber = root.plugin((ctx) => {
    ctx.on(NAME, () => {
      hits += 1;
    });
  });

  await sleep(450);
  const whileLoaded = hits;

  await probeFiber.dispose();
  await sleep(150);
  const atUnload = hits;
  await sleep(450);
  const afterUnload = hits - atUnload;

  root.plugin((ctx) => {
    ctx.on(NAME, () => {
      hits += 1;
    });
  });
  await sleep(450);
  const afterReload = hits - atUnload;

  results.checks.unsubscribeAndReactivate = {
    hitsWhileLoaded: whileLoaded,
    hitsInFirst450msAfterUnload: afterUnload,
    hitsAfterReload: afterReload,
    verdict:
      whileLoaded > 0 && afterUnload === 0 && afterReload > 0 ? 'unsubscribe-then-resubscribe' : 'unexpected',
  };
  await root.fiber.dispose();
}

writeFileSync(resolve(here, 'event-cordis.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
