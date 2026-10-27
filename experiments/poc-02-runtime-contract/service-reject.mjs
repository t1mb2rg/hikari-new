// PoC-02 / s5：未声明的 Service get / provide 是否保持 Hikari 原 Runtime 的拒绝语义。
//
// 五个场景两侧各跑一遍：
//   R1 未在 requires 声明就去 get 别人提供的 service
//   R2 声明了 requires 但没人提供
//   R3 未在 provides 声明就 provide
//   R4 声明了 provides 但 setup 里没提供
//   R5 两个插件提供同一个 service
//
// 顺带测两种适配层：
//   loose  = PoC-01 的 adapter.mjs 原样（只转发 get/provide，不做声明检查）
//   strict = 在 loose 之上补回 Hikari 的六条错误（本轮产物，用来证明「可以逐字等价」）
//
// 运行：node experiments/poc-02-runtime-contract/service-reject.mjs

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

const FOO = { id: 'poc02.reject.foo', version: 1 };
const BAR = { id: 'poc02.reject.bar', version: 1 };
const name = (c) => `${c.id.replace(/[^A-Za-z0-9]/g, '_')}_v${c.version}`;
const pick = (error) => (error ? { type: error.constructor.name, message: error.message } : null);

const def = (id, requires, provides, setup) => ({ id, version: '1.0.0', requires, provides, setup });

// ── Hikari 侧 ──────────────────────────────────────────────────────────
const hikari = {};
async function hikariRun(label, defs) {
  const runtime = new Runtime();
  const failed = [];
  const states = {};
  for (const d of defs) {
    // loadPlugin 不抛（除 DuplicatePluginError）：失败表现为 state='failed' + getPluginError
    const state = await runtime.loadPlugin(d);
    states[d.id] = state;
    if (state === 'failed') {
      const error = runtime.getPluginError(d.id);
      failed.push({ plugin: d.id, ...pick(error) });
    }
  }
  hikari[label] = { states, failed };
  await runtime.shutdown();
}

await hikariRun('R1-undeclared-get', [
  def('p-foo', [], [FOO], (ctx) => ctx.services.provide(FOO, 'v')),
  def('p-reader', [], [], (ctx) => {
    ctx.services.get(FOO);
  }),
]);

await hikariRun('R2-missing-provider', [
  def('p-needy', [FOO], [], () => {}),
]);

await hikariRun('R3-undeclared-provide', [
  def('p-sneaky', [], [], (ctx) => ctx.services.provide(FOO, 'v')),
]);

await hikariRun('R4-declared-but-silent', [
  def('p-silent', [], [FOO], () => {}),
]);

await hikariRun('R5-duplicate-provider', [
  def('p-one', [], [FOO], (ctx) => ctx.services.provide(FOO, 'one')),
  def('p-two', [], [FOO], (ctx) => ctx.services.provide(FOO, 'two')),
]);

// ── 适配层：loose 与 strict ────────────────────────────────────────────
const HIKARI_ERRORS = {
  undeclaredDep: (pluginId, serviceId) =>
    Object.assign(new Error(`Plugin ${pluginId} tried to use undeclared service dependency ${serviceId}.`), {
      name: 'UndeclaredServiceDependencyError',
    }),
  undeclaredProvide: (pluginId, serviceId) =>
    Object.assign(new Error(`Plugin ${pluginId} tried to provide undeclared service ${serviceId}.`), {
      name: 'UndeclaredServiceProviderError',
    }),
  unavailable: (serviceId) =>
    Object.assign(new Error(`Service is unavailable: ${serviceId}`), { name: 'ServiceUnavailableError' }),
  alreadyProvided: (serviceId, ownerId) =>
    Object.assign(new Error(`Service ${serviceId} is already provided by ${ownerId}.`), {
      name: 'ServiceAlreadyProvidedError',
    }),
  declaredButSilent: (pluginId, serviceId) =>
    Object.assign(new Error(`Plugin ${pluginId} declared service ${serviceId} but did not provide it during setup.`), {
      name: 'ServiceNotProvidedError',
    }),
};

function toPlugin(d, mode) {
  const providedOnce = new Set();
  const plugin = async (ctx) => {
    const required = new Set((d.requires ?? []).map(name));
    const allowed = new Set((d.provides ?? []).map(name));

    const hikariContext = {
      pluginId: d.id,
      services: {
        get(contract) {
          const key = name(contract);
          if (mode === 'strict' && !required.has(key)) throw HIKARI_ERRORS.undeclaredDep(d.id, key);
          const value = mode === 'strict' ? ctx.get(key, false) : ctx.get(key, false);
          if (value === undefined) {
            if (mode === 'strict') throw HIKARI_ERRORS.unavailable(key);
            throw new Error(`[adapter] service ${key} is not provided`);
          }
          return value;
        },
        provide(contract, provider) {
          const key = name(contract);
          if (mode === 'strict') {
            if (!allowed.has(key)) throw HIKARI_ERRORS.undeclaredProvide(d.id, key);
            if (ctx.get(key, false) !== undefined) throw HIKARI_ERRORS.alreadyProvided(key, d.id);
          }
          providedOnce.add(key);
          return ctx.provide(key, provider);
        },
      },
      events: { on() {}, async emit() {} },
      defer(cleanup) {
        ctx.effect(() => async () => {
          await cleanup();
        });
      },
    };

    await d.setup(hikariContext);
    if (mode === 'strict') {
      for (const key of allowed) {
        if (!providedOnce.has(key)) throw HIKARI_ERRORS.declaredButSilent(d.id, key);
      }
    }
  };
  plugin.inject = (d.requires ?? []).map(name);
  return plugin;
}

async function cordisRun(label, defs, mode) {
  const root = new Context();
  const errors = [];
  const states = {};
  for (const d of defs) {
    const fiber = root.plugin(toPlugin(d, mode));
    await new Promise((r) => setTimeout(r, 120));
    states[d.id] = fiber.state;
    if (fiber.state === 3) {
      errors.push({ plugin: d.id, state: fiber.state, error: fiber.error ? String(fiber.error.message ?? fiber.error) : null });
    }
  }
  await root.fiber.dispose();
  return { states, failed: errors };
}

const cordis = { loose: {}, strict: {} };
const SCENARIOS = {
  'R1-undeclared-get': [
    def('p-foo', [], [FOO], (ctx) => ctx.services.provide(FOO, 'v')),
    def('p-reader', [], [], (ctx) => {
      ctx.services.get(FOO);
    }),
  ],
  'R2-missing-provider': [def('p-needy', [FOO], [], () => {})],
  'R3-undeclared-provide': [def('p-sneaky', [], [], (ctx) => ctx.services.provide(FOO, 'v'))],
  'R4-declared-but-silent': [def('p-silent', [], [FOO], () => {})],
  'R5-duplicate-provider': [
    def('p-one', [], [FOO], (ctx) => ctx.services.provide(FOO, 'one')),
    def('p-two', [], [FOO], (ctx) => ctx.services.provide(FOO, 'two')),
  ],
};

for (const [label, defs] of Object.entries(SCENARIOS)) {
  cordis.loose[label] = await cordisRun(label, defs, 'loose');
  cordis.strict[label] = await cordisRun(label, defs, 'strict');
}

const results = { scenarios: Object.keys(SCENARIOS), hikari, cordis };
writeFileSync(resolve(here, 'service-reject.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
