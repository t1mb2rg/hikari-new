// PoC-01 / s2：把 Hikari 的只读领域插件装进 Cordis 宿主，并与 Hikari 原 Runtime 对照。
//
// 规则：适配器只做桥接（service 注册、依赖注入、cleanup 托管），
// 领域实现一律 import 自 hikari-new 的 dist/，不复制、不改写、不造返回值。
//
// 运行：node experiments/poc-01-dsh-cordis/p1-cordis.mjs
// 依赖：hikari-new 已 `npm run build`；DSH 已安装到 DSH_ROOT（见 DSH_ROOT 常量）。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

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
const { Runtime } = await import(HIKARI('runtime/runtime.js'));

const LAYERS = [
  { def: foreground.foregroundPlugin, contracts: [foreground.foregroundService] },
  { def: inputActivity.inputActivityPlugin, contracts: [inputActivity.inputActivityService] },
  { def: world.desktopSessionWorldPlugin, contracts: [world.desktopSessionWorldService] },
  {
    def: awareness.desktopSessionAwarenessPlugin,
    contracts: [awareness.desktopSessionAwarenessService, awareness.desktopSessionAwarenessPeekService],
  },
];

/** Hikari 的契约键是 `id@version`；Cordis 的服务名要能当标识符用，所以编码成 `id_vN`。 */
const serviceName = (contract) => `${contract.id.replace(/[^A-Za-z0-9]/g, '_')}_v${contract.version}`;

/**
 * 最小桥接：把任意 Hikari PluginDefinition 变成 Cordis 插件。
 * 只转发 services.get / services.provide / defer / setup 返回值，不做任何领域判断。
 */
function toCordisPlugin(def, config) {
  const plugin = async (ctx) => {
    const disposers = [];
    const hikariContext = {
      pluginId: def.id,
      services: {
        get(contract) {
          const name = serviceName(contract);
          const value = ctx.get(name, false);
          if (value === undefined) {
            throw new Error(`[adapter] service ${name} is not provided`);
          }
          return value;
        },
        provide(contract, provider) {
          disposers.push(ctx.provide(serviceName(contract), provider));
        },
      },
      events: {
        on() {
          throw new Error('[adapter] events are out of scope for P1');
        },
        emit() {
          throw new Error('[adapter] events are out of scope for P1');
        },
      },
      defer(cleanup) {
        disposers.push(cleanup);
      },
    };

    const returned = await def.setup(hikariContext, config);
    if (typeof returned === 'function') disposers.push(returned);

    ctx.effect(() => async () => {
      for (const dispose of disposers.reverse()) await dispose();
    });
  };

  plugin.inject = (def.requires ?? []).map(serviceName);
  return plugin;
}

const summarize = (assessment) => {
  if (!assessment) return null;
  if (assessment.kind === 'baseline') {
    return {
      kind: 'baseline',
      current: {
        foreground: assessment.current.foreground.kind,
        inputActivity: assessment.current.inputActivity.kind,
        title: assessment.current.foreground.kind === 'available'
          ? assessment.current.foreground.observation.foreground.title ?? null
          : null,
        processName: assessment.current.foreground.kind === 'available'
          ? assessment.current.foreground.observation.foreground.processName ?? null
          : null,
        lastInputTick: assessment.current.inputActivity.kind === 'available'
          ? assessment.current.inputActivity.observation.lastInputTick ?? null
          : null,
      },
    };
  }
  return {
    kind: 'comparison',
    foreground: assessment.foreground,
    inputActivity: assessment.inputActivity,
    change: assessment.change,
    title: assessment.current.foreground.kind === 'available'
      ? assessment.current.foreground.observation.foreground.title ?? null
      : null,
    lastInputTick: assessment.current.inputActivity.kind === 'available'
      ? assessment.current.inputActivity.observation.lastInputTick ?? null
      : null,
  };
};

const SERIES = async (peek, current) => ({
  peek1: summarize(await peek.peek()),
  peek2: summarize(await peek.peek()), // 连读两次：baseline 不动，所以第二次仍是 baseline
  current1: summarize(await current.current()),
  peek3: summarize(await peek.peek()), // baseline 已被 current 推进，这里应是 comparison
});

async function runHikariRuntime() {
  const runtime = new Runtime();
  let peekService;
  let currentService;

  await runtime.loadPlugin(foreground.foregroundPlugin);
  await runtime.loadPlugin(inputActivity.inputActivityPlugin);
  await runtime.loadPlugin(world.desktopSessionWorldPlugin);
  await runtime.loadPlugin(awareness.desktopSessionAwarenessPlugin);

  const probe = {
    id: 'poc01.probe',
    version: '1.0.0',
    requires: [awareness.desktopSessionAwarenessService, awareness.desktopSessionAwarenessPeekService],
    provides: [],
    setup(context) {
      currentService = context.services.get(awareness.desktopSessionAwarenessService);
      peekService = context.services.get(awareness.desktopSessionAwarenessPeekService);
    },
  };
  const state = await runtime.loadPlugin(probe);

  const states = {};
  for (const layer of LAYERS) states[layer.def.id] = runtime.getPluginState(layer.def.id);
  states[probe.id] = state;

  const series = await SERIES(peekService, currentService);
  await runtime.shutdown();
  return { states, series };
}

async function runCordis() {
  const root = new Context();
  const states = {};
  for (const layer of LAYERS) {
    const fiber = root.plugin(toCordisPlugin(layer.def, undefined));
    await fiber;
    states[layer.def.id] = fiber.state ?? 'unknown';
  }

  const peekService = root.get(serviceName(awareness.desktopSessionAwarenessPeekService), false);
  const currentService = root.get(serviceName(awareness.desktopSessionAwarenessService), false);

  const series = await SERIES(peekService, currentService);
  return { root, states, series, peekService, currentService };
}

const result = { startedAt: new Date().toISOString() };
try {
  result.hikari = await runHikariRuntime();
} catch (error) {
  result.hikari = { error: String(error?.stack ?? error) };
}
try {
  const cordisRun = await runCordis();
  result.cordis = { states: cordisRun.states, series: cordisRun.series };
  await cordisRun.root.fiber.dispose();
} catch (error) {
  result.cordis = { error: String(error?.stack ?? error) };
}

writeFileSync(resolve(here, 'p1-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
