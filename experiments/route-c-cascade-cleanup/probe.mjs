// §4.4 裁决① 的前置探针：**只观察，不改适配层**。
//
// 要回答的问题是：cleanup 失败之后，Provider 恢复时依赖方会不会自己回来？
//
// 这决定了「把状态翻译成 failed」是不是诚实的做法：
//   - 若两侧都不重启 → 报 failed 与宿主真实状态一致，修复成立。
//   - 若 Cordis 会自动重装而 Hikari 的 failed 不动 → 报 failed 只是让读数好看，
//     插件实际还在跑，那就是用簿记冒充生命周期语义（Human 明确禁止）。
//
// 两侧各跑一遍同一套探针：裸 Cordis（宿主原生态）与 Hikari 原 Runtime。
//
// 运行：node experiments/route-c-cascade-cleanup/probe.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const K_VALUE = Object.freeze({ id: 'probe.value', version: 1 });
const SERVICE_NAME = 'probe_value_1';
const BOOM = 'BoomCleanup: 级联停用时清理失败';

/** 每次装载都创建一个新实例，用实例序号区分「同一次装载」与「重新装载」。 */
function makeProvider() {
  const obs = { setupCount: 0, cleanupCount: 0, instance: 0 };
  const factory = () => {
    obs.instance += 1;
    obs.setupCount += 1;
    const payload = { from: 'probe.p', instance: obs.instance };
    return {
      payload,
      cleanup: () => {
        obs.cleanupCount += 1;
      },
    };
  };
  return { obs, factory };
}

/** 依赖方：cleanup 一定抛错。 */
function makeDependent() {
  const obs = { setupCount: 0, cleanupCount: 0, cleanupErrors: 0 };
  const factory = () => {
    obs.setupCount += 1;
    return {
      cleanup: () => {
        obs.cleanupCount += 1;
        obs.cleanupErrors += 1;
        throw new Error(BOOM);
      },
    };
  };
  return { obs, factory };
}

// —————————————————————————————————— 裸 Cordis

async function runCordisSide() {
  const app = new Context({ name: 'probe-cordis' });
  const provider = makeProvider();
  const dependent = makeDependent();
  const phase = {};

  const loadProvider = async () => {
    const fiber = app.plugin((ctx) => {
      const { payload, cleanup } = provider.factory();
      ctx.provide(SERVICE_NAME, payload);
      ctx.effect(() => cleanup);
    });
    await fiber.await();
    return fiber;
  };

  const loadDependent = async () => {
    const plugin = (ctx) => {
      const { cleanup } = dependent.factory();
      // Cordis 会把 effect 清理错误送进日志流、不进 fiber._error，所以自己兜住再抛。
      ctx.effect(() => async () => {
        cleanup();
      });
    };
    plugin.inject = [SERVICE_NAME];
    const fiber = app.plugin(plugin);
    await fiber.await();
    return fiber;
  };

  const snap = (label, extra = {}) => ({
    label,
    at: new Date().toISOString(),
    provider: { ...provider.obs },
    dependent: { ...dependent.obs },
    dependentFiberState: `${dependentFiber?.state}:${['PENDING', 'LOADING', 'ACTIVE', 'FAILED', 'DISPOSED', 'UNLOADING'][dependentFiber?.state] ?? '?'}`,
    dependentFiberError: dependentFiber?._error === undefined ? null : String(dependentFiber._error),
    serviceResolvable: app.get(SERVICE_NAME, false) !== undefined,
    ...extra,
  });

  let providerFiber;
  let dependentFiber;

  providerFiber = await loadProvider();
  dependentFiber = await loadDependent();
  await sleep(120);
  phase.loaded = snap('装载 P 与 D');

  await providerFiber.dispose();
  await sleep(250);
  phase.providerGone = snap('卸掉 P（D 被级联停用，cleanup 抛错）');

  providerFiber = await loadProvider();
  await sleep(400);
  phase.providerBack = snap('重装 P（看 D 会不会自己回来）');

  return { app, phase, provider, dependent };
}

// —————————————————————————————————— Hikari 原 Runtime

async function runHikariSide() {
  const runtime = new Runtime();
  const provider = makeProvider();
  const dependent = makeDependent();
  const phase = {};

  const providerDefinition = () => ({
    id: 'probe.p',
    version: '1.0.0',
    requires: [],
    provides: [K_VALUE],
    setup(context) {
      const { payload, cleanup } = provider.factory();
      context.services.provide(K_VALUE, payload);
      return cleanup;
    },
  });

  const dependentDefinition = {
    id: 'probe.d',
    version: '1.0.0',
    requires: [K_VALUE],
    provides: [],
    setup() {
      const { cleanup } = dependent.factory();
      return cleanup;
    },
  };

  const snap = (label) => {
    const state = runtime.getPluginState('probe.d');
    const error = runtime.getPluginError?.('probe.d');
    return {
      label,
      at: new Date().toISOString(),
      provider: { ...provider.obs },
      dependent: { ...dependent.obs },
      dependentState: state,
      dependentErrorName: error?.name,
      dependentErrorMessage: error?.message,
      dependentErrorInner: Array.isArray(error?.errors)
        ? error.errors.map((e) => ({ name: e?.name, message: e?.message }))
        : undefined,
      serviceResolvable: (() => {
        try {
          return runtime.services?.get?.(K_VALUE) !== undefined;
        } catch {
          return 'n/a';
        }
      })(),
    };
  };

  await runtime.loadPlugin(providerDefinition());
  await runtime.loadPlugin(dependentDefinition);
  await sleep(120);
  phase.loaded = snap('装载 P 与 D');

  await runtime.unloadPlugin('probe.p');
  await sleep(250);
  phase.providerGone = snap('卸掉 P（D 被级联停用，cleanup 抛错）');

  await runtime.loadPlugin(providerDefinition());
  await sleep(400);
  phase.providerBack = snap('重装 P（看 D 会不会自己回来）');

  return { runtime, phase, provider, dependent };
}

const cordis = await runCordisSide();
const hikari = await runHikariSide();

const report = {
  frozenAt: new Date().toISOString(),
  boom: BOOM,
  cordis: cordis.phase,
  hikari: hikari.phase,
  verdict: {
    cordisRevivedDependent:
      cordis.phase.providerBack.dependent.setupCount > cordis.phase.providerGone.dependent.setupCount,
    hikariRevivedDependent:
      hikari.phase.providerBack.dependent.setupCount > hikari.phase.providerGone.dependent.setupCount,
  },
};

writeFileSync(resolve(here, 'probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log('=== 裸 Cordis ===');
console.log(JSON.stringify(cordis.phase, null, 2));
console.log('=== Hikari ===');
console.log(JSON.stringify(hikari.phase, null, 2));
console.log('=== 判定 ===');
console.log(JSON.stringify(report.verdict, null, 2));
