// PoC-01 / s3：P2 —— 卸载后 Service、监听与资源是否释放；依赖失效时两边各做什么。
//
// 两个宿主各做同一件事：启动四层 → 卸载最底层 provider（foreground.windows）→ 观察 → 重装。
// 运行：node experiments/poc-01-dsh-cordis/p2-lifecycle.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { toCordisPlugin, serviceName } from './adapter.mjs';

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

const LAYERS = [foreground.foregroundPlugin, inputActivity.inputActivityPlugin,
  world.desktopSessionWorldPlugin, awareness.desktopSessionAwarenessPlugin];
const BOTTOM = foreground.foregroundPlugin.id;

const probePeek = async (peek) => {
  if (!peek) return 'no-service';
  try {
    const a = await peek.peek();
    return a.kind;
  } catch (error) {
    return `throws:${String(error.message ?? error).slice(0, 60)}`;
  }
};

// ---------- Hikari 原 Runtime ----------
const hikariLog = {};
{
  const runtime = new Runtime();
  let peekService;
  const probe = {
    id: 'poc01.probe', version: '1.0.0',
    requires: [awareness.desktopSessionAwarenessPeekService],
    provides: [],
    setup(context) { peekService = context.services.get(awareness.desktopSessionAwarenessPeekService); },
  };

  for (const def of LAYERS) await runtime.loadPlugin(def);
  await runtime.loadPlugin(probe);
  const peekFactory = peekService; // 保留对象，用于观察它是否仍可读
  hikariLog.loaded = Object.fromEntries(
    [...LAYERS.map((d) => d.id), probe.id].map((id) => [id, runtime.getPluginState(id)]),
  );
  hikariLog.peekBefore = await probePeek(peekService);

  await runtime.unloadPlugin(BOTTOM);
  hikariLog.afterUnload = Object.fromEntries(
    [...LAYERS.map((d) => d.id), probe.id].map((id) => [id, runtime.getPluginState(id)]),
  );
  hikariLog.peekAfterUnload = await probePeek(peekFactory);

  await runtime.unloadPlugin(probe.id);
  await runtime.loadPlugin(foreground.foregroundPlugin);
  await runtime.loadPlugin(probe);
  hikariLog.afterReload = Object.fromEntries(
    [...LAYERS.map((d) => d.id), probe.id].map((id) => [id, runtime.getPluginState(id)]),
  );
  hikariLog.peekAfterReload = await probePeek(peekService);
  hikariLog.sameInstance = peekFactory === peekService;
  await runtime.shutdown();
}

// ---------- Cordis ----------
const cordisLog = {};
{
  const root = new Context();
  const fibers = new Map();
  const traces = [];

  const load = (def) => {
    const { plugin, trace } = toCordisPlugin(def);
    traces.push(trace);
    const fiber = root.plugin(plugin);
    fibers.set(def.id, fiber);
    return fiber;
  };
  const states = async () => Object.fromEntries(
    await Promise.all([...fibers].map(async ([id, fiber]) => [id, fiber.state])),
  );

  for (const def of LAYERS) load(def);
  await new Promise((r) => setTimeout(r, 200));
  cordisLog.loaded = await states();
  const peekName = serviceName(awareness.desktopSessionAwarenessPeekService);
  const peekBefore = root.get(peekName, false);
  cordisLog.peekBefore = await probePeek(peekBefore);

  await fibers.get(BOTTOM).dispose();
  await new Promise((r) => setTimeout(r, 200));
  cordisLog.afterUnload = await states();
  cordisLog.peekAfterUnload = await probePeek(root.get(peekName, false));
  cordisLog.peekAfterUnloadStaleRef = await probePeek(peekBefore);
  cordisLog.serviceGone = root.get(peekName, false) === undefined;

  cordisLog.tracesAfterUnload = traces.map((t) => ({
    label: t.label, provided: t.provided.length, cleanupsRegistered: t.cleanups.filter((c) => c === 'defer').length,
    cleanupsRan: t.cleanups.filter((c) => c === 'ran').length,
  }));

  load(foreground.foregroundPlugin);
  await new Promise((r) => setTimeout(r, 300));
  cordisLog.afterReload = await states();
  const peekAfter = root.get(peekName, false);
  cordisLog.peekAfterReload = await probePeek(peekAfter);
  cordisLog.sameInstance = peekBefore === peekAfter;

  await root.fiber.dispose();
  await new Promise((r) => setTimeout(r, 200));
  cordisLog.tracesAfterAllDisposed = traces.map((t) => ({
    label: t.label, cleanupsRan: t.cleanups.filter((c) => c === 'ran').length,
  }));
}

const result = { startedAt: new Date().toISOString(), hikari: hikariLog, cordis: cordisLog };
writeFileSync(resolve(here, 'p2-result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
