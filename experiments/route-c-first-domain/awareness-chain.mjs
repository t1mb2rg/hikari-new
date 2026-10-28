// s2：真实四层依赖链在契约层下的装载、级联停用与重新激活。
//
// 链条（全部来自源码，不是构造的探针）：
//   foreground.windows      provides foregroundService            src/foreground/plugin.ts:11-14
//   input-activity.windows  provides inputActivityService         src/input-activity/plugin.ts:11-14
//   desktop-session-world   requires 上面两项 → provides world    src/desktop-session-world/plugin.ts:12-15
//   desktop-session-awareness requires world → provides 两服务    src/desktop-session-awareness/plugin.ts:65-68
//   desktop-session-awareness-loop requires awareness → provides []  src/desktop-session-awareness-loop/plugin.ts:43-51
//
// 订阅者是隔离测试订阅者，不是生产消费者：生产消费者只有 desktop-content-read（src/cli/resident.ts:431）。
//
// 运行：node experiments/route-c-first-domain/awareness-chain.mjs
// 依赖：hikari-new 已 `npm run build`；DSH 已装在 DSH_ROOT。

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
const foreground = await import(HIKARI('foreground/index.js'));
const inputActivity = await import(HIKARI('input-activity/index.js'));
const world = await import(HIKARI('desktop-session-world/index.js'));
const awareness = await import(HIKARI('desktop-session-awareness/index.js'));
const loop = await import(HIKARI('desktop-session-awareness-loop/index.js'));
const { createContractLayer, loadHikariValidator } = await import(
  pathToFileURL(resolve(repo, 'experiments/poc-03-contract-layer/contract-layer.mjs')).href
);

const validateDefinition = await loadHikariValidator(repo);
const EVENT = loop.desktopSessionAwarenessAssessedEvent;
const EVENT_NAME = `${EVENT.id}@${EVENT.version}`;
const DELAY_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = new Context();
const layer = createContractLayer(app, { validateDefinition });

let assessedCount = 0;
let lastPayload = undefined;
const assessedAt = [];
app.on(EVENT_NAME, (payload) => {
  assessedCount += 1;
  assessedAt.push(Date.now());
  lastPayload = payload;
});

const CHAIN = [
  ['foreground.windows', foreground.foregroundPlugin],
  ['input-activity.windows', inputActivity.inputActivityPlugin],
  ['desktop-session-world', world.desktopSessionWorldPlugin],
  ['desktop-session-awareness', awareness.desktopSessionAwarenessPlugin],
  ['desktop-session-awareness-loop', loop.desktopSessionAwarenessLoopPlugin],
];
const LOOP_CONFIG = { delayMs: DELAY_MS };

const states = () =>
  Object.fromEntries(CHAIN.map(([id]) => [id, layer.getPluginState(id) ?? '(无记录)']));

function gaps(fromIndex) {
  const slice = assessedAt.slice(fromIndex);
  const out = [];
  for (let i = 1; i < slice.length; i += 1) out.push(slice[i] - slice[i - 1]);
  return out;
}

async function window(label, ms) {
  const before = assessedCount;
  const markAt = assessedAt.length;
  await sleep(ms);
  return {
    label,
    ms,
    from: before,
    to: assessedCount,
    added: assessedCount - before,
    // 事件间隔是「有没有第二个定时器」的直接读数：两个实例并存时间隔会减半。
    gapsMs: gaps(markAt),
  };
}

/** 同一套流程在 Hikari 原 Runtime 上跑一遍，作为契约层的对照基线。 */
async function runHikariSide() {
  const runtime = new Runtime();
  let count = 0;
  const at = [];
  // 隔离测试订阅者，不是生产消费者：Hikari 的 Runtime 没有对外暴露 events，
  // 只能用一个纯消费者插件订阅（生产消费者只有 desktop-content-read，src/cli/resident.ts:431）。
  const counter = {
    id: 'experiment.assessed-counter',
    version: '1.0.0',
    requires: [],
    provides: [],
    setup(context) {
      context.events.on(EVENT, () => {
        count += 1;
        at.push(Date.now());
      });
    },
  };

  const hStates = () =>
    Object.fromEntries(CHAIN.map(([id]) => [id, runtime.getPluginState(id) ?? '(无记录)']));
  const hWindow = async (ms) => {
    const before = count;
    const mark = at.length;
    await sleep(ms);
    const slice = at.slice(mark);
    const g = [];
    for (let i = 1; i < slice.length; i += 1) g.push(slice[i] - slice[i - 1]);
    return { from: before, to: count, added: count - before, gapsMs: g };
  };

  const phases = {};
  try {
    await runtime.loadPlugin(counter);
    const loadResults = {};
    for (const [id, def] of CHAIN) {
      loadResults[id] = await runtime.loadPlugin(def, id === 'desktop-session-awareness-loop' ? LOOP_CONFIG : undefined);
    }
    phases.load = { results: loadResults, states: hStates(), window: await hWindow(2000) };

    const startedAt = Date.now();
    await runtime.unloadPlugin('foreground.windows');
    phases.cascade = {
      settledAfterMs: Date.now() - startedAt,
      states: hStates(),
      window: await hWindow(1200),
    };

    await runtime.loadPlugin(foreground.foregroundPlugin);
    phases.reactivate = {
      statesImmediately: hStates(),
      window: await hWindow(2000),
      statesAfterWindow: hStates(),
    };

    await runtime.unloadPlugin('foreground.windows');
    phases.teardown = { window: await hWindow(600), states: hStates() };
  } finally {
    try {
      await runtime.shutdown();
    } catch {
      /* 一次性实例 */
    }
  }
  return phases;
}

const report = { frozenAt: new Date().toISOString(), delayMs: DELAY_MS, phases: {} };

// —— 阶段 1：按真实顺序装载
const loadResults = {};
for (const [id, def] of CHAIN) {
  loadResults[id] = await layer.loadPlugin(def, id === 'desktop-session-awareness-loop' ? LOOP_CONFIG : undefined);
}
report.phases.load = { results: loadResults, states: states(), window: await window('装载后稳定运行', 2000) };
console.log('装载：', JSON.stringify(report.phases.load.states), '事件 +', report.phases.load.window.added, '间隔', report.phases.load.window.gapsMs);

// —— 阶段 2：卸载链条最上游，观察级联
const unloadStartedAt = Date.now();
await layer.unloadPlugin('foreground.windows');
const settledAfterMs = Date.now() - unloadStartedAt;
report.phases.cascade = {
  unloaded: 'foreground.windows',
  settledAfterMs,
  states: states(),
  window: await window('级联停用后', 1200),
};
console.log('卸载 foreground 后：', JSON.stringify(report.phases.cascade.states), '事件 +', report.phases.cascade.window.added);

// —— 阶段 3：把最上游装回来，观察下游是否自动重新激活
const reloadStartedAt = Date.now();
await layer.loadPlugin(foreground.foregroundPlugin);
const reloadSettledMs = Date.now() - reloadStartedAt;
report.phases.reactivate = {
  reloaded: 'foreground.windows',
  settledMs: reloadSettledMs,
  statesImmediately: states(),
  window: await window('重新激活后', 2000),
  // 窗口结束时再采一次：装载后立即采的话，awareness 可能还在 loading。
  statesAfterWindow: states(),
};
console.log('重装 foreground 后（窗口结束）：', JSON.stringify(report.phases.reactivate.statesAfterWindow), '事件 +', report.phases.reactivate.window.added, '间隔', report.phases.reactivate.window.gapsMs);

// —— 阶段 4：收尾
await layer.unloadPlugin('desktop-session-awareness-loop');
await layer.unloadPlugin('desktop-session-awareness');
await layer.unloadPlugin('desktop-session-world');
await layer.unloadPlugin('input-activity.windows');
await layer.unloadPlugin('foreground.windows');
report.phases.teardown = {
  states: states(),
  window: await window('全部卸载后', 600),
  records: layer.inspect ? layer.inspect() : undefined,
};
console.log('收尾后事件 +', report.phases.teardown.window.added);

// —— 对照：同一流程在 Hikari 原 Runtime 上跑一遍
report.hikariSide = await runHikariSide();
console.log('[Hikari 对照] 装载', JSON.stringify(report.hikariSide.load.states), '事件 +' + report.hikariSide.load.window.added);
console.log('[Hikari 对照] 卸载后', JSON.stringify(report.hikariSide.cascade.states), '事件 +' + report.hikariSide.cascade.window.added);
console.log('[Hikari 对照] 重装后', JSON.stringify(report.hikariSide.reactivate.statesAfterWindow), '事件 +' + report.hikariSide.reactivate.window.added, '间隔', report.hikariSide.reactivate.window.gapsMs);

report.payloadShape = lastPayload === undefined ? null : Object.keys(lastPayload ?? {});

writeFileSync(resolve(here, 'awareness-chain.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('\n=== 汇总 ===');
for (const [name, phase] of Object.entries(report.phases)) {
  if (phase.window) console.log(`${name.padEnd(12)} 事件 +${phase.window.added}`);
}
