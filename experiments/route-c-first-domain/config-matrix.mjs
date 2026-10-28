// s1：真实 config.parse 在三侧的拦截对照。
//
// 对象是两个真实的 Hikari 领域插件，不是探针：
//   desktop-session-awareness-loop  config.parse 在 src/desktop-session-awareness-loop/plugin.ts:19-41
//   human-delivery                  config.parse 在 src/human-delivery/plugin.ts:32-43
//
// 三侧：
//   hikari          Runtime.loadPlugin —— 配置解析在记录建立之前同步抛（src/runtime/runtime.ts:38）
//   cordis          Context.plugin     —— 裸宿主，不调 definition.config.parse
//   contractLayer   PoC-03 契约层      —— 层 2 调 parse，抛 ContractLayerError(layer='config')
//
// 裸 Cordis 侧只回答「装载时是否拒绝」，不测激活：它没有 depends 声明检查，
// 合法配置也会因为拿不到依赖服务而在激活期失败，那是另一件事，混在一起就看不出来了。
//
// 运行：node experiments/route-c-first-domain/config-matrix.mjs
// 依赖：hikari-new 已 `npm run build`；DSH 已装在 DSH_ROOT。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const loop = await import(HIKARI('desktop-session-awareness-loop/index.js'));
const delivery = await import(HIKARI('human-delivery/index.js'));
const { createContractLayer, loadHikariValidator } = await import(
  pathToFileURL(resolve(repo, 'experiments/poc-03-contract-layer/contract-layer.mjs')).href
);

const validateDefinition = await loadHikariValidator(repo);
const TMP_ROOT = join(tmpdir(), 'poc-first-domain-config-matrix');

const CASES = [
  { plugin: 'loop', label: 'delayMs=100（合法）', def: loop.desktopSessionAwarenessLoopPlugin, input: { delayMs: 100 } },
  { plugin: 'loop', label: 'delayMs=0', def: loop.desktopSessionAwarenessLoopPlugin, input: { delayMs: 0 } },
  { plugin: 'loop', label: 'delayMs=-1', def: loop.desktopSessionAwarenessLoopPlugin, input: { delayMs: -1 } },
  { plugin: 'loop', label: 'delayMs=1.5', def: loop.desktopSessionAwarenessLoopPlugin, input: { delayMs: 1.5 } },
  { plugin: 'loop', label: "delayMs='100'", def: loop.desktopSessionAwarenessLoopPlugin, input: { delayMs: '100' } },
  { plugin: 'loop', label: 'delayMs 缺字段', def: loop.desktopSessionAwarenessLoopPlugin, input: {} },
  { plugin: 'loop', label: 'input=null', def: loop.desktopSessionAwarenessLoopPlugin, input: null },
  {
    plugin: 'loop',
    label: 'delayMs=2147483648（超出定时器上界）',
    def: loop.desktopSessionAwarenessLoopPlugin,
    input: { delayMs: 2_147_483_648 },
  },
  { plugin: 'delivery', label: 'rootDir=临时目录（合法）', def: delivery.humanDeliveryPlugin, input: { rootDir: TMP_ROOT } },
  { plugin: 'delivery', label: "rootDir=''", def: delivery.humanDeliveryPlugin, input: { rootDir: '' } },
  { plugin: 'delivery', label: "rootDir='   '", def: delivery.humanDeliveryPlugin, input: { rootDir: '   ' } },
  { plugin: 'delivery', label: 'rootDir=123', def: delivery.humanDeliveryPlugin, input: { rootDir: 123 } },
  { plugin: 'delivery', label: 'rootDir 缺字段', def: delivery.humanDeliveryPlugin, input: {} },
  { plugin: 'delivery', label: 'input=null', def: delivery.humanDeliveryPlugin, input: null },
];

const cordisName = (contract) => `${contract.id}@${contract.version}`;

/** 裸 Cordis 侧的最小桥接：不调 config.parse，原样把 input 当配置交给 setup。 */
function barePlugin(def, input) {
  const plugin = async (ctx) => {
    const context = {
      pluginId: def.id,
      services: {
        get: (contract) => ctx.get(cordisName(contract), false),
        provide: (contract, provider) => ctx.provide(cordisName(contract), provider),
      },
      events: {
        on: (contract, handler) => ctx.on(cordisName(contract), handler),
        emit: async (contract, payload) => ctx.parallel(cordisName(contract), payload),
      },
      defer: (cleanup) => ctx.effect(() => async () => await cleanup()),
    };
    const config = def.config ? input : undefined; // 关键：这里没有 parse
    await def.setup(context, config);
  };
  plugin.inject = [...(def.requires ?? [])].map(cordisName);
  return plugin;
}

async function runHikari(def, input) {
  const runtime = new Runtime();
  try {
    await runtime.loadPlugin(def, input);
    const state = runtime.getPluginState(def.id) ?? 'unknown';
    try {
      await runtime.unloadPlugin(def.id);
    } catch {
      /* 一次性实例，卸载失败不影响「是否拒绝」这一读数 */
    }
    return { rejected: false, state };
  } catch (error) {
    return { rejected: true, message: error?.message ?? String(error), kind: error?.constructor?.name };
  } finally {
    try {
      await runtime.shutdown();
    } catch {
      /* 一次性实例，收尾失败不影响读数 */
    }
  }
}

async function runBareCordis(def, input) {
  const app = new Context();
  let fiber;
  try {
    fiber = app.plugin(barePlugin(def, input));
    let setupError;
    try {
      await fiber.await();
    } catch (error) {
      setupError = error?.message ?? String(error);
    }
    return {
      rejectedAtLoad: false, // 装载这一步没有拒绝
      fiberState: fiber.state,
      setupError,
    };
  } catch (error) {
    // app.plugin 本身若抛，也算装载期拒绝（实测中不会发生）
    return { rejectedAtLoad: true, message: error?.message ?? String(error) };
  } finally {
    // 必须真的 dispose：human-delivery 会建真实命名管道，不释放会让后一侧撞 EADDRINUSE。
    try {
      await fiber?.dispose?.();
    } catch {
      /* ignore */
    }
  }
}

async function runContractLayer(def, input) {
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition });
  try {
    const state = await layer.loadPlugin(def, input);
    const error = layer.getPluginError?.(def.id);
    const failedLayer = layer.getPluginLayer?.(def.id);
    await layer.unloadPlugin?.(def.id);
    return {
      rejected: false,
      state,
      // 装载没被拒但激活失败时，把失败原因一起记下来：只看 state 看不见这一层。
      activationError: error ? (error?.message ?? String(error)) : undefined,
      activationErrorKind: error?.constructor?.name,
      activationLayer: failedLayer,
    };
  } catch (error) {
    return {
      rejected: true,
      layer: error?.layer,
      message: error?.message ?? String(error),
      kind: error?.constructor?.name,
    };
  } finally {
    try {
      app.stop?.();
    } catch {
      /* ignore */
    }
  }
}

const rows = [];
for (const item of CASES) {
  const hikari = await runHikari(item.def, item.input);
  const cordis = await runBareCordis(item.def, item.input);
  const contractLayer = await runContractLayer(item.def, item.input);

  const row = {
    plugin: item.plugin,
    label: item.label,
    input: item.input,
    hikari,
    cordis,
    contractLayer,
    agreement: {
      hikariRejects: hikari.rejected === true,
      contractLayerRejects: contractLayer.rejected === true,
      sameDecision: hikari.rejected === contractLayer.rejected,
      sameMessage: hikari.rejected && hikari.message === contractLayer.message,
      bareCordisRejects: cordis.rejectedAtLoad === true,
    },
  };
  rows.push(row);
  console.log(
    `${item.label.padEnd(34)} hikari=${hikari.rejected ? '拒绝' : '放行'} ` +
      `cordis=${cordis.rejectedAtLoad ? '拒绝' : '放行'} ` +
      `契约层=${contractLayer.rejected ? '拒绝' : '放行'}` +
      (hikari.rejected && contractLayer.rejected && hikari.message !== contractLayer.message
        ? '  ← 消息不同'
        : ''),
  );
}

const summary = {
  frozenAt: new Date().toISOString(),
  repo,
  cordisRoot: DSH_ROOT,
  tmpRoot: TMP_ROOT,
  totalCases: rows.length,
  hikariRejects: rows.filter((r) => r.agreement.hikariRejects).length,
  contractLayerRejects: rows.filter((r) => r.agreement.contractLayerRejects).length,
  bareCordisRejects: rows.filter((r) => r.agreement.bareCordisRejects).length,
  sameDecisionAll: rows.every((r) => r.agreement.sameDecision),
  sameMessageAll: rows.every((r) => !r.agreement.hikariRejects || r.agreement.sameMessage),
};

writeFileSync(
  resolve(here, 'config-matrix.json'),
  `${JSON.stringify({ summary, rows }, null, 2)}\n`,
  'utf8',
);

console.log('\n=== 汇总 ===');
console.log(JSON.stringify(summary, null, 2));
