// PoC-03 / s3：三层失败（定义验证 / 配置解析 / setup）在三处的可观察区别。
//
// 三处对照：
//   A. Hikari 原 Runtime        —— 基准
//   B. 裸 Cordis Context        —— 不用契约层，宿主原生表现
//   C. Cordis + 契约层          —— 本轮的适配层
//
// 每处 × 每个场景记录：loadPlugin 是同步抛还是返回状态、抛/存的是什么对象、能否用
// getPluginError 读回、状态是什么、错误类型叫什么。
//
// 运行：node experiments/poc-03-contract-layer/three-layers.mjs
// 依赖：hikari-new 已 `npm run build`。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator, ContractLayerError } from './contract-layer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const { Runtime } = await import(HIKARI('runtime/runtime.js'));
const validatePluginDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BoomSetup extends Error {
  constructor() {
    super('setup exploded on purpose');
    this.name = 'BoomSetup';
    this.marker = 'poc03-setup';
  }
}
class BoomConfig extends Error {
  constructor() {
    super('config rejected on purpose');
    this.name = 'BoomConfig';
    this.marker = 'poc03-config';
  }
}

// ---------------------------------------------------------------- 三个场景

const contract = { id: 'poc03.probe', version: 1 };

const sceneDefinitionError = () => ({
  // id 为空 → Hikari 的 validatePluginDefinition 第一句就抛
  id: '   ',
  version: '1',
  setup() {},
});

const sceneConfigError = () => ({
  id: 'poc03.config-probe',
  version: '1',
  config: {
    parse() {
      throw new BoomConfig();
    },
  },
  setup() {},
});

const sceneSetupError = () => ({
  id: 'poc03.setup-probe',
  version: '1',
  provides: [contract],
  async setup(context) {
    context.services.provide(contract, { sign: 'poc03' });
    throw new BoomSetup();
  },
});

// ---------------------------------------------------------------- 三处执行

const describeError = (error) => {
  if (error === undefined || error === null) return null;
  return {
    isError: error instanceof Error,
    ctor: error?.constructor?.name ?? typeof error,
    name: error?.name ?? null,
    message: error?.message ?? String(error),
    layer: error?.layer ?? null,
    originalName: error?.original?.name ?? null,
    marker: error?.marker ?? error?.original?.marker ?? null,
  };
};

/** A：Hikari 原 Runtime */
async function runHikari(makeDefinition) {
  const runtime = new Runtime();
  const definition = makeDefinition();
  let threw = null;
  let state = null;
  try {
    state = await runtime.loadPlugin(definition);
  } catch (error) {
    threw = error;
  }
  return {
    path: state === null ? '同步/异步抛出' : '返回状态',
    thrown: describeError(threw),
    returnedState: state,
    recordedState: runtime.getPluginState(definition.id) ?? null,
    recordedError: describeError(runtime.getPluginError(definition.id)),
  };
}

/** B：裸 Cordis，不用契约层 */
async function runBareCordis(makeDefinition) {
  const app = new Context();
  const definition = makeDefinition();
  let threw = null;
  let fiber = null;
  try {
    // 裸宿主不认识 Hikari 的 PluginDefinition：直接用 setup 当 apply
    fiber = app.plugin(typeof definition.setup === 'function' ? definition.setup.bind(null, {
      pluginId: definition.id,
      services: { get() { return undefined; }, provide() {} },
      events: { on() {}, emit() {} },
      defer() {},
    }) : definition);
    await fiber.await();
  } catch (error) {
    threw = error;
  }
  const out = {
    path: threw ? '抛出' : '未抛出',
    thrown: describeError(threw),
    returnedState: fiber ? fiber.state : null,
    externalRecordedState: 'n/a（宿主无 getPluginState）',
    externalRecordedError: 'n/a（宿主无 getPluginError）',
  };
  try { await fiber?.dispose?.(); } catch { /* ignore */ }
  return out;
}

/** C：Cordis + 契约层 */
async function runContractLayer(makeDefinition) {
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const definition = makeDefinition();
  let threw = null;
  let state = null;
  try {
    state = await layer.loadPlugin(definition, undefined);
  } catch (error) {
    threw = error;
  }
  await sleep(10);
  return {
    path: state === null ? '同步/异步抛出' : '返回状态',
    thrown: describeError(threw),
    returnedState: state,
    recordedState: layer.getPluginState(definition.id) ?? null,
    recordedLayer: layer.getPluginLayer(definition.id) ?? null,
    recordedError: describeError(layer.getPluginError(definition.id)),
  };
}

// ---------------------------------------------------------------- 跑

const scenes = [
  { key: 'definition', title: '定义验证失败（id 为空白）', make: sceneDefinitionError },
  { key: 'config', title: '配置解析失败（parse 抛 BoomConfig）', make: sceneConfigError },
  { key: 'setup', title: 'setup 失败（provide 之后抛 BoomSetup）', make: sceneSetupError },
];

const result = {
  environment: { node: process.version, cordis: '4.0.5', dsh: '0.2.1-rc.2' },
  scenes: {},
};

for (const scene of scenes) {
  result.scenes[scene.key] = {
    title: scene.title,
    hikari: await runHikari(scene.make),
    bareCordis: await runBareCordis(scene.make),
    contractLayer: await runContractLayer(scene.make),
  };
}

// ---------------------------------------------------------------- 判定

const S = result.scenes;
result.verdict = {
  hikariThreeLayersDistinguishable:
    S.definition.hikari.thrown !== null &&
    S.config.hikari.thrown !== null &&
    S.setup.hikari.thrown === null &&
    S.setup.hikari.returnedState === 'failed',
  // 裸宿主连「定义」这一层都没有：两个场景都不会抛，因为它根本不检查 id 与 config.parse
  bareCordisHasNoDefinitionOrConfigCheck:
    S.definition.bareCordis.thrown === null && S.config.bareCordis.thrown === null,
  // setup 失败在裸宿主里只能靠抛出观察（state 3 本身不带错误对象）
  bareCordisSetupFailureIsThrowOnly:
    S.setup.bareCordis.returnedState === 3 && S.setup.bareCordis.thrown !== null,
  contractLayerThreeLayersDistinguishable:
    // 前两层是「同步抛，错误自己带 layer」，第三层是「不抛、落成记录」
    S.definition.contractLayer.thrown?.layer === 'definition' &&
    S.config.contractLayer.thrown?.layer === 'config' &&
    S.setup.contractLayer.recordedLayer === 'setup',
  contractLayerKeepsOriginalObject:
    S.setup.contractLayer.recordedError?.name === 'BoomSetup' &&
    S.setup.contractLayer.recordedError?.marker === 'poc03-setup',
};

writeFileSync(resolve(here, 'three-layers.json'), `${JSON.stringify(result, null, 2)}\n`);

// ---------------------------------------------------------------- 打印

for (const scene of scenes) {
  const r = result.scenes[scene.key];
  console.log(`\n=== ${scene.title} ===`);
  console.log('  Hikari      ', r.hikari.path, '| state=', r.hikari.returnedState,
    '| thrown=', r.hikari.thrown?.name ?? '无', '| recorded=', r.hikari.recordedError?.name ?? '无');
  console.log('  裸 Cordis   ', r.bareCordis.path, '| fiberState=', r.bareCordis.returnedState,
    '| thrown=', r.bareCordis.thrown?.name ?? '无');
  console.log('  契约层      ', r.contractLayer.path, '| state=', r.contractLayer.returnedState,
    '| layer=', r.contractLayer.recordedLayer, '| thrown=', r.contractLayer.thrown?.name ?? '无',
    '| recorded=', r.contractLayer.recordedError?.name ?? '无');
}
console.log('\n判定:', JSON.stringify(result.verdict, null, 0));
