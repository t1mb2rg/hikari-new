// PoC-03 / s5：失败回滚验证。
//
// 场景（任务书第六项）：插件在 setup 里注册 Service、订阅 Event，然后中途抛错。
// 要验证三件事：
//   1. 失败原因可观察（原错误对象，不是只有 FAILED 状态）
//   2. 资源被释放（Service 注销、Event 退订）
//   3. 重新装载不残留旧注册
//
// 两侧各跑一遍：Hikari 原 Runtime 与 Cordis + 契约层。
//
// 运行：node experiments/poc-03-contract-layer/rollback.mjs
// 依赖：hikari-new 已 `npm run build`。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator } from './contract-layer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const validatePluginDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SVC = Object.freeze({ id: 'poc03.rollback.service', version: 1 });
const EVT = Object.freeze({ id: 'poc03.rollback.event', version: 1 });

class BoomSetup extends Error {
  constructor() {
    super('rollback probe: setup failed on purpose');
    this.name = 'BoomSetup';
    this.marker = 'rollback-marker-42';
  }
}

/** 每次观测独立计数，避免两侧互相污染 */
function freshObs() {
  return { subscriberCalls: 0, emitter: null };
}

/** setup 里注册 service + 订阅 event，然后抛错 */
function failingDefinition(obs) {
  return {
    id: 'poc03.rollback.failing',
    version: '1',
    provides: [SVC],
    setup(context) {
      context.services.provide(SVC, { sign: 'rollback' });
      context.events.on(EVT, () => {
        obs.subscriberCalls += 1;
      });
      throw new BoomSetup();
    },
  };
}

/** 用来发事件的插件：把 emit 函数交给外部，再由测试触发 */
function emitterDefinition(obs) {
  return {
    id: 'poc03.rollback.emitter',
    version: '1',
    setup(context) {
      obs.emitter = () => context.events.emit(EVT, { tick: 1 });
    },
  };
}

/** 探测某个 service 是否还能被解析：能解析 → 插件 active，不能 → waiting */
function probeDefinition() {
  return {
    id: 'poc03.rollback.probe',
    version: '1',
    requires: [SVC],
    setup() {},
  };
}

function describe(error) {
  if (error === null || error === undefined) return null;
  return {
    name: error.name ?? error.constructor?.name ?? typeof error,
    message: error.message ?? String(error),
    isSameInstanceClass: error instanceof BoomSetup,
    marker: error.marker ?? null,
  };
}

// ---------------------------------------------------------------- Hikari

async function runHikari() {
  const obs = freshObs();
  const runtime = new Runtime();
  const steps = {};

  await runtime.loadPlugin(emitterDefinition(obs)).catch(() => {});

  // 1) 失败装载
  let threw = null;
  try {
    await runtime.loadPlugin(failingDefinition(obs));
  } catch (error) {
    threw = error;
  }
  await sleep(5);

  steps.failingThrewToCaller = describe(threw);
  steps.failingState = runtime.getPluginState('poc03.rollback.failing') ?? null;
  steps.failingError = describe(runtime.getPluginError('poc03.rollback.failing'));

  // 2) Service 是否残留：探针若能激活说明服务还在
  await runtime.loadPlugin(probeDefinition()).catch(() => {});
  await sleep(10);
  steps.serviceStillResolvable = runtime.getPluginState('poc03.rollback.probe') === 'active';

  // 3) Event 订阅是否残留：发一次事件，看失败插件注册的回调还会不会被调
  const before = obs.subscriberCalls;
  if (obs.emitter) await obs.emitter().catch(() => {});
  await sleep(10);
  steps.subscriberCallsAfterFailure = obs.subscriberCalls - before;

  // 4) 卸载失败记录后重装同 id 的干净版本
  //    两侧语义都要求先卸载：失败记录仍占着 id，直接重装会 DuplicatePluginError
  let unloadThrew = null;
  try {
    await runtime.unloadPlugin('poc03.rollback.failing');
  } catch (error) {
    unloadThrew = error;
  }
  await sleep(5);
  steps.unloadThrew = describe(unloadThrew);

  let reloadThrew = null;
  try {
    await runtime.loadPlugin({
      id: 'poc03.rollback.failing',
      version: '1',
      provides: [SVC],
      setup(context) {
        context.services.provide(SVC, { sign: 'clean' });
      },
    });
  } catch (error) {
    reloadThrew = error;
  }
  await sleep(10);
  steps.reloadState = runtime.getPluginState('poc03.rollback.failing') ?? null;
  steps.reloadThrew = describe(reloadThrew);

  await runtime.shutdown().catch(() => {});
  return steps;
}

// ---------------------------------------------------------------- Cordis + 契约层

async function runLayer() {
  const obs = freshObs();
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const steps = {};

  await layer.loadPlugin(emitterDefinition(obs), undefined).catch(() => {});

  let threw = null;
  try {
    await layer.loadPlugin(failingDefinition(obs), undefined);
  } catch (error) {
    threw = error;
  }
  await sleep(5);

  steps.failingThrewToCaller = describe(threw);
  steps.failingState = layer.getPluginState('poc03.rollback.failing') ?? null;
  steps.failingLayer = layer.getPluginLayer('poc03.rollback.failing') ?? null;
  steps.failingError = describe(layer.getPluginError('poc03.rollback.failing'));

  await layer.loadPlugin(probeDefinition(), undefined).catch(() => {});
  await sleep(10);
  steps.serviceStillResolvable = layer.getPluginState('poc03.rollback.probe') === 'active';

  const before = obs.subscriberCalls;
  if (obs.emitter) await obs.emitter().catch(() => {});
  await sleep(10);
  steps.subscriberCallsAfterFailure = obs.subscriberCalls - before;

  let unloadThrew = null;
  try {
    await layer.unloadPlugin('poc03.rollback.failing');
  } catch (error) {
    unloadThrew = error;
  }
  await sleep(5);
  steps.unloadThrew = describe(unloadThrew);

  let reloadThrew = null;
  try {
    await layer.loadPlugin(
      {
        id: 'poc03.rollback.failing',
        version: '1',
        provides: [SVC],
        setup(context) {
          context.services.provide(SVC, { sign: 'clean' });
        },
      },
      undefined,
    );
  } catch (error) {
    reloadThrew = error;
  }
  await sleep(10);
  steps.reloadState = layer.getPluginState('poc03.rollback.failing') ?? null;
  steps.reloadThrew = describe(reloadThrew);
  steps.inspect = layer.inspect();

  await Promise.all([
    layer.unloadPlugin('poc03.rollback.failing').catch(() => {}),
    layer.unloadPlugin('poc03.rollback.probe').catch(() => {}),
    layer.unloadPlugin('poc03.rollback.emitter').catch(() => {}),
  ]);
  return steps;
}

// ---------------------------------------------------------------- 跑

const result = {
  environment: { node: process.version, cordis: '4.0.5', dsh: '0.2.1-rc.2' },
  hikari: await runHikari(),
  contractLayer: await runLayer(),
};

/** 三条判据：能观察到原因 / 资源已释放 / 重装不残留 */
const judge = (side) => ({
  errorObservable:
    side.failingState === 'failed' &&
    side.failingError?.marker === 'rollback-marker-42',
  serviceReleased: side.serviceStillResolvable === false,
  subscriberReleased: side.subscriberCallsAfterFailure === 0,
  reloadClean:
    side.reloadState === 'active' &&
    (side.reloadThrew === null || side.reloadThrew === undefined) &&
    (side.unloadThrew === null || side.unloadThrew === undefined),
});

result.verdict = {
  hikari: judge(result.hikari),
  contractLayer: judge(result.contractLayer),
};
result.verdict.allHeld =
  Object.values(result.verdict.hikari).every(Boolean) &&
  Object.values(result.verdict.contractLayer).every(Boolean);

writeFileSync(resolve(here, 'rollback.json'), `${JSON.stringify(result, null, 2)}\n`);

const show = (side, label) => {
  console.log(`\n=== ${label} ===`);
  console.log('  失败装载：threwToCaller=%s  state=%s  error=%s%s',
    side.failingThrewToCaller?.name ?? '无',
    side.failingState,
    side.failingError?.name ?? '无',
    side.failingLayer ? `  layer=${side.failingLayer}` : '');
  if (side.failingError) console.log('    消息: %s  marker=%s', side.failingError.message, side.failingError.marker);
  console.log('  Service 残留: %s（探针 %s）', side.serviceStillResolvable ? '是' : '否', side.serviceStillResolvable ? 'active' : 'waiting');
  console.log('  订阅者残留: 失败后 emit 触发 %d 次', side.subscriberCallsAfterFailure);
  console.log('  卸载失败记录: threw=%s', side.unloadThrew?.name ?? '无');
  console.log('  重装同 id: state=%s  threw=%s', side.reloadState, side.reloadThrew?.name ?? '无');
};
show(result.hikari, 'Hikari 原 Runtime');
show(result.contractLayer, 'Cordis + 契约层');
console.log('\n判定:', JSON.stringify(result.verdict, null, 0));
