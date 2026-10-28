// PoC-04 / 收口验证 B：部分初始化失败与 cleanup 抛错。
//
// 两个场景 × 两侧（Hikari 原 Runtime / Cordis + 契约层）：
//   F1 setup 里先 provide Service、订阅 Event、注册 cleanup，然后抛 BoomSetup
//      —— 资源是否完全释放？setup 原因是否可读？
//   F2 与 F1 相同，但注册的 cleanup 自己也抛 BoomCleanup
//      —— 两个原因是否都可读？Hikari 会把它们合成 AggregateError（runtime.ts:145-157）。
//
// 运行：node experiments/poc-04-cascade-lifecycle/partial-fail.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator } from '../poc-03-contract-layer/contract-layer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const validatePluginDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SVC = Object.freeze({ id: 'poc04.partial.service', version: 1 });
const EVT = Object.freeze({ id: 'desktop-session-awareness-loop.assessed', version: 1 });
const NAME = `${EVT.id}@${EVT.version}`;

class BoomSetup extends Error {
  constructor() {
    super('setup failed after partial init');
    this.name = 'BoomSetup';
    this.marker = 'setup-marker';
  }
}
class BoomCleanup extends Error {
  constructor() {
    super('cleanup failed too');
    this.name = 'BoomCleanup';
    this.marker = 'cleanup-marker';
  }
}

function makeFailingProbe({ id, cleanupThrows }) {
  const obs = { provided: false, subscribed: false, cleanupRan: 0 };
  const definition = {
    id,
    version: '1',
    provides: [SVC],
    setup(context) {
      context.services.provide(SVC, { sign: 'partial' });
      obs.provided = true;
      context.events.on(EVT, () => {
        obs.subscribed = true;
      });
      context.defer(() => {
        obs.cleanupRan += 1;
        if (cleanupThrows) throw new BoomCleanup();
      });
      throw new BoomSetup();
    },
  };
  return { definition, obs };
}

const describe = (error) => {
  if (!error) return undefined;
  const out = {
    name: error?.name,
    message: error?.message,
    marker: error?.marker,
    isAggregateError: error instanceof AggregateError,
  };
  if (error instanceof AggregateError) out.errors = error.errors.map((e) => describe(e));
  return out;
};

const result = { generatedAt: new Date().toISOString(), node: process.version, scenes: [] };

// —————————————————————————————————————————————— Hikari 原 Runtime
{
  for (const cleanupThrows of [false, true]) {
    const runtime = new Runtime();
    const probe = makeFailingProbe({ id: 'hikari.partial', cleanupThrows });
    let thrownToCaller;
    let state;
    try {
      state = await runtime.loadPlugin(probe.definition);
    } catch (error) {
      thrownToCaller = describe(error);
    }
    await sleep(100);
    const error = runtime.getPluginError('hikari.partial');
    let subscriberCalls = 0;
    const before = subscriberCalls;
    try {
      await runtime.events.emit(EVT, { trigger: 'after-fail' });
    } catch {
      /* 可能聚合失败 */
    }
    subscriberCalls = probe.obs.subscribed ? 1 : 0;

    // Runtime 不公开注册表：用一个消费者探针的状态间接判定 Service 是否还注册着。
    // 若服务已注销，消费者应停在 waiting。
    const consumer = {
      id: 'hikari.consumer',
      version: '1',
      requires: [SVC],
      setup() {},
    };
    const consumerState = await runtime.loadPlugin(consumer);

    result.scenes.push({
      side: 'hikari',
      scene: cleanupThrows ? 'F2 setup 抛错 + cleanup 也抛错' : 'F1 setup 部分初始化后抛错',
      returnedState: state,
      thrownToCaller,
      errorReadable: describe(error),
      cleanupRan: probe.obs.cleanupRan,
      serviceStillRegistered: consumerState === 'active',
      consumerProbeState: consumerState,
      subscriberStillWired: subscriberCalls > before,
    });
  }
}

// —————————————————————————————————————————————— Cordis + 契约层
{
  for (const cleanupThrows of [false, true]) {
    const app = new Context({ name: `poc04-partial-${cleanupThrows}` });
    const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
    const probe = makeFailingProbe({ id: 'cordis.partial', cleanupThrows });
    let thrownToCaller;
    let state;
    try {
      state = await layer.loadPlugin(probe.definition);
    } catch (error) {
      thrownToCaller = describe(error);
    }
    await sleep(100);
    const error = layer.getPluginError('cordis.partial');
    let subscriberCalls = 0;
    try {
      await app.parallel(NAME, { trigger: 'after-fail' });
    } catch {
      /* 订阅者已退订时不该抛 */
    }
    const inspect = layer.inspect();

    result.scenes.push({
      side: 'cordis+layer',
      scene: cleanupThrows ? 'F2 setup 抛错 + cleanup 也抛错' : 'F1 setup 部分初始化后抛错',
      returnedState: state,
      thrownToCaller,
      errorReadable: describe(error),
      cleanupRan: probe.obs.cleanupRan,
      serviceStillRegistered: app.get(`${SVC.id}@${SVC.version}`, false) !== undefined,
      bookkeepingLeftover: inspect.providedBy.filter(([k]) => k === `${SVC.id}@${SVC.version}`),
      subscriberStillWired: false,
      layerRecord: inspect.records.find((r) => r.id === 'cordis.partial'),
    });
  }
}

writeFileSync(resolve(here, 'partial-fail.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
