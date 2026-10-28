// PoC-04 / 主任务：级联生命周期。
//
// 用真实 Hikari 契约 id（foreground.current@1 → desktop-session-world.current@1 →
// desktop-session-awareness.current@1）构造 A→B→C 三级依赖与一个无关插件 D，
// 观察「装载 → 卸载 A → 重装 A」全过程中：
//   - 每个插件的 setup 次数、cleanup 次数、计时器 tick 数、事件订阅回调次数
//   - 适配层 records 状态与 Cordis 宿主 fiber 状态
//   - Service 在宿主注册表里的真实存在性（app.get(key, false)）
//   - 适配层自维护的 providedBy 簿记是否与实际一致
//
// 运行：node experiments/poc-04-cascade-lifecycle/cascade.mjs
// 依赖：hikari-new 已 `npm run build`；DSH_ROOT 指向装了 @deepseek-ai/cordis 的目录。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator } from '../poc-03-contract-layer/contract-layer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const validatePluginDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// —— 真实 Hikari 契约（id 与 version 均取自 src，未改写）
const K_FOREGROUND = Object.freeze({ id: 'foreground.current', version: 1 });
const K_WORLD = Object.freeze({ id: 'desktop-session-world.current', version: 1 });
const K_AWARENESS = Object.freeze({ id: 'desktop-session-awareness.current', version: 1 });
const K_EVENT = Object.freeze({ id: 'desktop-session-awareness-loop.assessed', version: 1 });

const key = (c) => `${c.id}@${c.version}`;

// —— 观测台：每个插件一个槽位，计数只增不减，便于看「旧实例是否还在动」
const TICK_MS = 20;

function makeProbe({ id, requires = [], provides = [], tickMs = TICK_MS }) {
  const obs = {
    id,
    setupCount: 0,
    cleanupCount: 0,
    tickCount: 0,
    subscriberCalls: 0,
    upstreamAtSetup: undefined,
    lastCleanupTick: undefined,
    timers: 0,
  };

  const definition = {
    id,
    version: '1',
    requires,
    provides,
    setup(context) {
      obs.setupCount += 1;
      for (const contract of requires) {
        obs.upstreamAtSetup = context.services.get(contract);
      }

      context.events.on(K_EVENT, () => {
        obs.subscriberCalls += 1;
      });

      const timer = setInterval(() => {
        obs.tickCount += 1;
      }, tickMs);
      timer.unref?.();
      obs.timers += 1;

      if (provides.length > 0) {
        const payload = { from: id, instance: obs.setupCount, tick: () => obs.tickCount };
        for (const contract of provides) context.services.provide(contract, payload);
      }

      return () => {
        obs.cleanupCount += 1;
        obs.lastCleanupTick = obs.tickCount;
        obs.timers -= 1;
        clearInterval(timer);
      };
    },
  };

  return { definition, obs };
}

const probes = {
  A: makeProbe({ id: 'poc04.a', provides: [K_FOREGROUND] }),
  B: makeProbe({ id: 'poc04.b', requires: [K_FOREGROUND], provides: [K_WORLD] }),
  C: makeProbe({ id: 'poc04.c', requires: [K_WORLD], provides: [K_AWARENESS] }),
  D: makeProbe({ id: 'poc04.d' }),
};

const app = new Context({ name: 'poc04-cascade' });
const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });

const snapshot = (label) => {
  const inspect = layer.inspect();
  return {
    label,
    at: new Date().toISOString(),
    layerStates: Object.fromEntries(inspect.records.map((r) => [r.id, r.state])),
    layerProvidedBy: Object.fromEntries(inspect.providedBy),
    // 宿主注册表里的真实存在性：绕过适配层簿记，直接问 Cordis
    hostServices: Object.fromEntries(
      [K_FOREGROUND, K_WORLD, K_AWARENESS].map((c) => [key(c), app.get(key(c), false) !== undefined]),
    ),
    fiberStates: Object.fromEntries(
      inspect.records.map((r) => [r.id, layer.getPluginState(r.id)]),
    ),
    rawFiberStates: Object.fromEntries(
      inspect.records.map((r) => [r.id, `${r.fiberState}:${r.fiberStateName}`]),
    ),
    obs: Object.fromEntries(
      Object.entries(probes).map(([name, p]) => [
        name,
        {
          setupCount: p.obs.setupCount,
          cleanupCount: p.obs.cleanupCount,
          tickCount: p.obs.tickCount,
          subscriberCalls: p.obs.subscriberCalls,
          timers: p.obs.timers,
        },
      ]),
    ),
  };
};

const timeline = [];
const step = async (label, fn) => {
  const result = fn ? await fn() : undefined;
  await sleep(120);
  const snap = snapshot(label);
  if (result !== undefined) snap.returned = result;
  timeline.push(snap);
  return snap;
};

// —— 1. 依次装载 A → B → C → D
await step('load A', () => layer.loadPlugin(probes.A.definition));
await step('load B', () => layer.loadPlugin(probes.B.definition));
await step('load C', () => layer.loadPlugin(probes.C.definition));
await step('load D', () => layer.loadPlugin(probes.D.definition));

// —— 2. 全部就绪后发一次事件、看计时器都在跑
await step('all loaded + emit', async () => {
  await app.parallel(key(K_EVENT), { trigger: 'all-loaded' });
});

// —— 3. 卸载 A（provider 消失）
await step('unload A', () => layer.unloadPlugin('poc04.a'));

// —— 4. 再发一次事件：C 的订阅若还在，会被记到
await step('after unload A + emit', async () => {
  await app.parallel(key(K_EVENT), { trigger: 'after-unload-A' });
});

// —— 5. 重装 A
await step('reload A', () => layer.loadPlugin(probes.A.definition));

// —— 6. 再发一次事件
await step('after reload A + emit', async () => {
  await app.parallel(key(K_EVENT), { trigger: 'after-reload-A' });
});

// —— 7. 收尾：卸载全部，看清理
await step('unload all', async () => {
  for (const id of ['poc04.d', 'poc04.c', 'poc04.b', 'poc04.a']) await layer.unloadPlugin(id);
});

const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  cordis: '4.0.5',
  tickMs: TICK_MS,
  contracts: { foreground: key(K_FOREGROUND), world: key(K_WORLD), awareness: key(K_AWARENESS), event: key(K_EVENT) },
  timeline,
};
writeFileSync(resolve(here, 'cascade.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(timeline.map((t) => ({
  label: t.label,
  states: t.layerStates,
  host: t.hostServices,
  obs: t.obs,
})), null, 2));
