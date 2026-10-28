// PoC-03 / s4：五条 requires/provides 纪律，Hikari 与契约层逐条对照。
//
// 任务书列的五条：
//   R1 未声明 get 拒绝
//   R2 依赖缺失保持 PENDING，而不是错误失败
//   R3 未声明 provide 拒绝
//   R4 声明 provides 但 setup 未提供时失败
//   R5 重复 provide 拒绝
//
// 每条两侧各跑一次：Hikari 原 Runtime 与 Cordis + 契约层。
//
// 运行：node experiments/poc-03-contract-layer/discipline.mjs
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

const A = Object.freeze({ id: 'poc03.alpha', version: 1 });
const B = Object.freeze({ id: 'poc03.beta', version: 1 });

const describe = (error) => {
  if (error === undefined || error === null) return null;
  return {
    name: error?.name ?? error?.constructor?.name ?? typeof error,
    message: error?.message ?? String(error),
    serviceId: error?.serviceId ?? null,
    pluginId: error?.pluginId ?? null,
  };
};

/** 一条纪律 = 一组插件定义 + 期望 */
const cases = [
  {
    key: 'R1',
    title: '未声明 get 拒绝',
    define: () => [
      {
        id: 'poc03.r1-provider',
        version: '1',
        provides: [A],
        setup(ctx) {
          ctx.services.provide(A, { sign: 'alpha' });
        },
      },
      {
        id: 'poc03.r1-consumer',
        version: '1',
        // 没有 requires，却在 setup 里 get
        setup(ctx) {
          ctx.services.get(A);
        },
      },
    ],
    expect: { state: 'failed', message: 'Plugin poc03.r1-consumer tried to use undeclared service dependency poc03.alpha@1.' },
  },
  {
    key: 'R2',
    title: '依赖缺失保持 waiting / PENDING',
    define: () => [
      {
        id: 'poc03.r2-consumer',
        version: '1',
        requires: [B], // 没人提供
        setup() {
          throw new Error('R2: setup 不该被执行');
        },
      },
    ],
    expect: { state: 'waiting', message: null },
  },
  {
    key: 'R3',
    title: '未声明 provide 拒绝',
    define: () => [
      {
        id: 'poc03.r3-provider',
        version: '1',
        // 没有 provides，却提供
        setup(ctx) {
          ctx.services.provide(A, { sign: 'alpha' });
        },
      },
    ],
    expect: { state: 'failed', message: 'Plugin poc03.r3-provider tried to provide undeclared service poc03.alpha@1.' },
  },
  {
    key: 'R4',
    title: '声明 provides 但未提供 → 失败',
    define: () => [
      {
        id: 'poc03.r4-liar',
        version: '1',
        provides: [A],
        setup() {
          /* 声明了却不 provide */
        },
      },
    ],
    expect: { state: 'failed', message: 'Plugin poc03.r4-liar declared service poc03.alpha@1 but did not provide it during setup.' },
  },
  {
    key: 'R5',
    title: '重复 provide 拒绝',
    define: () => [
      {
        id: 'poc03.r5-first',
        version: '1',
        provides: [A],
        setup(ctx) {
          ctx.services.provide(A, { sign: 'first' });
        },
      },
      {
        id: 'poc03.r5-second',
        version: '1',
        provides: [A],
        setup(ctx) {
          ctx.services.provide(A, { sign: 'second' });
        },
      },
    ],
    expect: { state: 'failed', message: 'Service poc03.alpha@1 is already provided by poc03.r5-first.' },
  },
];

// ---------------------------------------------------------------- 两侧执行

async function runHikari(definitions) {
  const runtime = new Runtime();
  const perPlugin = [];
  for (const def of definitions) {
    let threw = null;
    try {
      await runtime.loadPlugin(def);
    } catch (error) {
      threw = error;
    }
    await sleep(5);
    perPlugin.push({
      id: def.id,
      threw: describe(threw),
      state: runtime.getPluginState(def.id) ?? null,
      error: describe(runtime.getPluginError(def.id)),
    });
  }
  await runtime.shutdown().catch(() => {});
  return perPlugin;
}

async function runLayer(definitions) {
  const app = new Context();
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const perPlugin = [];
  for (const def of definitions) {
    let threw = null;
    try {
      await layer.loadPlugin(def, undefined);
    } catch (error) {
      threw = error;
    }
    await sleep(5);
    perPlugin.push({
      id: def.id,
      threw: describe(threw),
      state: layer.getPluginState(def.id) ?? null,
      layer: layer.getPluginLayer(def.id) ?? null,
      error: describe(layer.getPluginError(def.id)),
    });
  }
  await Promise.all(definitions.map((d) => layer.unloadPlugin(d.id).catch(() => {})));
  return perPlugin;
}

// ---------------------------------------------------------------- 跑

const result = {
  environment: { node: process.version, cordis: '4.0.5', dsh: '0.2.1-rc.2' },
  cases: {},
};

for (const c of cases) {
  const hikari = await runHikari(c.define());
  const layer = await runLayer(c.define());
  // 每条只看「最后一个插件」——它是被纪律拦住的那个
  const layerLast = layer[layer.length - 1] ?? layer[0];
  const layerMessage = layerLast.error?.message ?? layerLast.threw?.message ?? null;
  const passed =
    layerLast.state === c.expect.state &&
    (layerMessage === c.expect.message ||
      (c.expect.message === null && layerMessage === null));
  result.cases[c.key] = {
    title: c.title,
    expect: c.expect,
    hikari,
    contractLayer: layer,
    layerVerdict: passed ? 'PASS' : 'FAIL',
  };
}

const allPass = Object.values(result.cases).every((c) => c.layerVerdict === 'PASS');
result.verdict = {
  fiveDisciplinesHeld: allPass,
  perCase: Object.fromEntries(Object.entries(result.cases).map(([k, v]) => [k, v.layerVerdict])),
};

writeFileSync(resolve(here, 'discipline.json'), `${JSON.stringify(result, null, 2)}\n`);

for (const [key, value] of Object.entries(result.cases)) {
  console.log(`\n=== ${key} ${value.title} ===`);
  console.log('  Hikari:');
  for (const p of value.hikari) {
    console.log(`    ${p.id}: state=${p.state} thrown=${p.threw?.name ?? '无'} error=${p.error?.name ?? '无'}`);
    if (p.error?.message) console.log(`      消息: ${p.error.message}`);
  }
  console.log('  契约层:');
  for (const p of value.contractLayer) {
    console.log(`    ${p.id}: state=${p.state} layer=${p.layer ?? '-'} thrown=${p.threw?.name ?? '无'} error=${p.error?.name ?? '无'}`);
    if (p.error?.message) console.log(`      消息: ${p.error.message}`);
  }
  console.log(`  判定: ${value.layerVerdict}`);
}
console.log('\n五条纪律:', JSON.stringify(result.verdict, null, 0));
