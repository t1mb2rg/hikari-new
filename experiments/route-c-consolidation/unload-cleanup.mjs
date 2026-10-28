// Route-C 收口 / 正常卸载路径上的 cleanup 抛错：三侧最小对照。
//
// 这不是新 PoC。PoC-04 §8 第 1 条明确留了一句「正常卸载时 cleanup 抛错仍被
// unloadPlugin 的 try/catch 吞掉，本轮未修」，这里只是把那个读数补上。
//
// 两个场景 × 三侧。两个场景必须分开，因为它们在 Hikari 里走的是两条不同的代码路径：
//
//   场景 1 显式卸载：unloadPlugin(id) → #deactivateTree → #tearDown → 记录被删
//   场景 2 级联停用：provider 被卸载 → 依赖方 #deactivate → #tearDown → 记录保留
//
// 三侧：
//   A. Hikari 原 Runtime（dist/）
//   B. 裸 Cordis Context（DSH 隔离目录里的 cordis 4.0.5）
//   C. Cordis + PoC-04 修后的契约层
//
// 每侧每场景记四件互不替代的事，不合成为一个 PASS/FAIL：
//   ① 资源回收    cleanup 调了几次、计时器真的停了吗、service 真的撤了吗
//   ② 可观察性    错误能不能从某个公开接口读回来
//   ③ 最终状态    插件/依赖方最后处于什么状态
//   ④ 原有契约    与 Hikari 原语义相比，差在哪
//
// 运行：node experiments/route-c-consolidation/unload-cleanup.mjs
// 依赖：hikari-new 已 `npm run build`；DSH_ROOT 指向 PoC-01 的隔离目录。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator } from '../poc-03-contract-layer/contract-layer.mjs';
import { toCordisPlugin, serviceName } from '../poc-02-runtime-contract/adapter-events.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const validateDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BoomCleanup extends Error {
  constructor() {
    super('cleanup exploded on purpose');
    this.name = 'BoomCleanup';
    this.marker = 'route-c-cleanup';
  }
}

const SVC = { id: 'route-c.unload.svc', version: 1 };

/** 每轮独立计数，避免三侧互相污染 */
function counters() {
  return { providerTicks: 0, dependentTicks: 0, providerCleanups: 0, dependentCleanups: 0 };
}

function providerDefinition(c) {
  return {
    id: 'route-c.provider',
    version: '1',
    provides: [SVC],
    setup(context) {
      context.services.provide(SVC, { hello: 'world' });
      const timer = setInterval(() => {
        c.providerTicks += 1;
      }, 10);
      return () => {
        clearInterval(timer);
        c.providerCleanups += 1;
        throw new BoomCleanup();
      };
    },
  };
}

function dependentDefinition(c) {
  return {
    id: 'route-c.dependent',
    version: '1',
    requires: [SVC],
    setup(context) {
      context.services.get(SVC);
      const timer = setInterval(() => {
        c.dependentTicks += 1;
      }, 10);
      return () => {
        clearInterval(timer);
        c.dependentCleanups += 1;
        throw new BoomCleanup();
      };
    },
  };
}

/** 一个只用来问「service 还在吗」的探针：能激活就是还在 */
function probeDefinition() {
  return { id: 'route-c.probe', version: '1', requires: [SVC], setup() {} };
}

const describeError = (error) =>
  error === null || error === undefined
    ? null
    : { name: error.name ?? '?', message: error.message ?? String(error), marker: error.marker ?? null };

// ------------------------------------------------------------------ A. Hikari

async function hikariScenario1() {
  const c = counters();
  const runtime = new Runtime();
  await runtime.loadPlugin(providerDefinition(c));
  const stateOnLoad = runtime.getPluginState('route-c.provider');
  await sleep(40);
  const ticksBefore = c.providerTicks;

  await runtime.unloadPlugin('route-c.provider');
  await sleep(60);
  const ticksAfter = c.providerTicks;

  const probeState = await runtime.loadPlugin(probeDefinition()).catch((e) => `threw:${e.name}`);

  return {
    providerCleanups: c.providerCleanups,
    timerKeptRunning: ticksAfter > ticksBefore,
    serviceStillResolvable: probeState === 'active',
    stateAfterUnload: runtime.getPluginState('route-c.provider') ?? null,
    errorReadable: describeError(runtime.getPluginError('route-c.provider')),
    stateOnLoad,
  };
}

async function hikariScenario2() {
  const c = counters();
  const runtime = new Runtime();
  await runtime.loadPlugin(providerDefinition(c));
  await runtime.loadPlugin(dependentDefinition(c));
  const dependentOnLoad = runtime.getPluginState('route-c.dependent');
  await sleep(40);

  // 只卸 provider，dependent 由 #reconcile 级联停用，记录保留
  await runtime.unloadPlugin('route-c.provider');
  await sleep(60);

  return {
    dependentCleanups: c.dependentCleanups,
    dependentState: runtime.getPluginState('route-c.dependent') ?? null,
    dependentErrorReadable: describeError(runtime.getPluginError('route-c.dependent')),
    dependentOnLoad,
  };
}

// ------------------------------------------------------------- B. 裸 Cordis
//
// 这一侧刻意不用 PoC-02 的 adapter-events.mjs：那个适配层 `await def.setup(...)`
// 后**丢掉了 setup 的返回值**（Hikari 的「setup 返回 cleanup」契约），用它对照会把
// 适配层的遗漏算到宿主头上。这里直接写 Cordis 原生 plugin，测的是宿主本身。

async function cordisScenario1() {
  const c = counters();
  const app = new Context();
  const plugin = async (ctx) => {
    ctx.provide(serviceName(SVC), { hello: 'world' });
    const timer = setInterval(() => {
      c.providerTicks += 1;
    }, 10);
    ctx.effect(() => () => {
      clearInterval(timer);
      c.providerCleanups += 1;
      throw new BoomCleanup();
    }, 'route-c.provider.cleanup');
  };
  const fiber = app.plugin(plugin);
  await fiber.await();
  await sleep(40);
  const ticksBefore = c.providerTicks;

  await fiber.dispose();
  await sleep(60);

  const name = serviceName(SVC);
  return {
    providerCleanups: c.providerCleanups,
    timerKeptRunning: c.providerTicks > ticksBefore,
    serviceStillResolvable: app.get(name, false) !== undefined,
    fiberState: fiber.state,
    errorReadable: describeError(fiber._error),
  };
}

async function cordisScenario2() {
  const c = counters();
  const app = new Context();
  const name = serviceName(SVC);

  const providerPlugin = async (ctx) => {
    ctx.provide(name, { hello: 'world' });
    const timer = setInterval(() => {
      c.providerTicks += 1;
    }, 10);
    ctx.effect(() => () => {
      clearInterval(timer);
      c.providerCleanups += 1;
      throw new BoomCleanup();
    }, 'route-c.provider.cleanup');
  };
  const dependentPlugin = async (ctx) => {
    ctx.get(name, false);
    const timer = setInterval(() => {
      c.dependentTicks += 1;
    }, 10);
    ctx.effect(() => () => {
      clearInterval(timer);
      c.dependentCleanups += 1;
      throw new BoomCleanup();
    }, 'route-c.dependent.cleanup');
  };
  dependentPlugin.inject = [name];

  const providerFiber = app.plugin(providerPlugin);
  await providerFiber.await();
  const dependentFiber = app.plugin(dependentPlugin);
  await dependentFiber.await();
  await sleep(40);

  await providerFiber.dispose();
  await sleep(60);

  return {
    dependentCleanups: c.dependentCleanups,
    dependentFiberState: dependentFiber.state,
    dependentErrorReadable: describeError(dependentFiber._error),
  };
}

// ------------------------------------------------------------- C. 契约层

async function layerScenario1() {
  const c = counters();
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition });

  await layer.loadPlugin(providerDefinition(c));
  const stateOnLoad = layer.getPluginState('route-c.provider');
  await sleep(40);
  const ticksBefore = c.providerTicks;

  await layer.unloadPlugin('route-c.provider');
  await sleep(60);

  const probeState = await layer.loadPlugin(probeDefinition()).catch((e) => `threw:${e.name}`);

  return {
    providerCleanups: c.providerCleanups,
    timerKeptRunning: c.providerTicks > ticksBefore,
    serviceStillResolvable: probeState === 'active',
    stateAfterUnload: layer.getPluginState('route-c.provider') ?? null,
    errorReadable: describeError(layer.getPluginError('route-c.provider')),
    stateOnLoad,
  };
}

async function layerScenario2() {
  const c = counters();
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition });

  await layer.loadPlugin(providerDefinition(c));
  await layer.loadPlugin(dependentDefinition(c));
  const dependentOnLoad = layer.getPluginState('route-c.dependent');
  await sleep(40);

  await layer.unloadPlugin('route-c.provider');
  await sleep(60);

  return {
    dependentCleanups: c.dependentCleanups,
    dependentState: layer.getPluginState('route-c.dependent') ?? null,
    dependentErrorReadable: describeError(layer.getPluginError('route-c.dependent')),
    dependentOnLoad,
  };
}

// ------------------------------------------------------------------ 跑

const step = (msg) => process.stdout.write(`· ${msg}\n`);

step('场景 1 / Hikari');
const s1h = await hikariScenario1();
step('场景 1 / 裸 Cordis');
const s1c = await cordisScenario1();
step('场景 1 / 契约层');
const s1l = await layerScenario1();
step('场景 2 / Hikari');
const s2h = await hikariScenario2();
step('场景 2 / 裸 Cordis');
const s2c = await cordisScenario2();
step('场景 2 / 契约层');
const s2l = await layerScenario2();

const result = {
  at: new Date().toISOString(),
  versions: { cordis: '4.0.5', dsh: '0.2.1-rc.2', node: process.version },
  scenario1_explicitUnload: { hikari: s1h, cordis: s1c, layer: s1l },
  scenario2_cascadeDeactivate: { hikari: s2h, cordis: s2c, layer: s2l },
};

writeFileSync(resolve(here, 'unload-cleanup.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');

const show = (label, v) => console.log(label, JSON.stringify(v));
console.log('=== 场景 1：显式 unloadPlugin ===');
for (const side of ['hikari', 'cordis', 'layer']) show(side.padEnd(7), result.scenario1_explicitUnload[side]);
console.log('=== 场景 2：provider 消失导致级联停用 ===');
for (const side of ['hikari', 'cordis', 'layer']) show(side.padEnd(7), result.scenario2_cascadeDeactivate[side]);
