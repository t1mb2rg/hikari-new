// PoC-04 / 异步激活竞争与 PENDING 等待（主任务第 4、5 项）。
//
// 三个场景：
//   S1 PENDING 装载：先装依赖方，提供方还不存在 —— 装载调用是否立即返回？
//   S2 迟到提供：提供方的 setup 是异步的（200 ms 后才 provide），依赖方在它完成前装载 ——
//      依赖方是否停在 waiting 并在提供方就绪后自动激活？
//   S3 provider 中途消失：依赖方的 setup 是异步的（300 ms），装到一半把提供方卸载 ——
//      依赖方最终状态、cleanup 是否跑了、计时器与订阅是否清掉？
//
// 运行：node experiments/poc-04-cascade-lifecycle/race.mjs

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createContractLayer, loadHikariValidator } from '../poc-03-contract-layer/contract-layer.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const validatePluginDefinition = await loadHikariValidator(repo);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint() / 1_000_000n);

const K_UP = Object.freeze({ id: 'foreground.current', version: 1 });
const K_DOWN = Object.freeze({ id: 'desktop-session-world.current', version: 1 });
const K_EVENT = Object.freeze({ id: 'desktop-session-awareness-loop.assessed', version: 1 });
const key = (c) => `${c.id}@${c.version}`;

function makeProbe({ id, requires = [], provides = [], setupDelayMs = 0, provideDelayMs = 0 }) {
  const obs = { setupStart: 0, setupEnd: 0, cleanupCount: 0, tickCount: 0, subscriberCalls: 0, timers: 0 };
  const definition = {
    id,
    version: '1',
    requires,
    provides,
    async setup(context) {
      obs.setupStart = now();
      // 先订阅、先开计时器：这样「setup 中途被打断」时才有东西可验是否清掉
      context.events.on(K_EVENT, () => {
        obs.subscriberCalls += 1;
      });
      const timer = setInterval(() => {
        obs.tickCount += 1;
      }, 20);
      timer.unref?.();
      obs.timers += 1;

      if (setupDelayMs) await sleep(setupDelayMs);
      if (provideDelayMs) await sleep(provideDelayMs);

      if (provides.length) {
        for (const contract of provides) context.services.provide(contract, { from: id });
      }
      obs.setupEnd = now();

      return () => {
        obs.cleanupCount += 1;
        obs.timers -= 1;
        clearInterval(timer);
      };
    },
  };
  return { definition, obs };
}

const report = { generatedAt: new Date().toISOString(), node: process.version, scenarios: [] };

const observe = (layer, ids) => ({
  states: Object.fromEntries(ids.map((id) => [id, layer.getPluginState(id)])),
  host: Object.fromEntries([K_UP, K_DOWN].map((c) => [key(c), layer && true])),
});

// ——————————————————————————————————————————————— S1：PENDING 装载是否阻塞
{
  const app = new Context({ name: 'poc04-s1' });
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const B = makeProbe({ id: 's1.b', requires: [K_UP], provides: [K_DOWN] });
  const t0 = now();
  const state = await layer.loadPlugin(B.definition);
  const elapsed = now() - t0;
  await sleep(150);
  report.scenarios.push({
    name: 'S1 PENDING 装载',
    question: '依赖未满足时 loadPlugin 是否立即返回',
    returnedState: state,
    elapsedMs: elapsed,
    stateAfterSettle: layer.getPluginState('s1.b'),
    setupCount: B.obs.setupEnd > 0 ? 1 : 0,
    tickCountWhilePending: B.obs.tickCount,
    host: { up: app.get(key(K_UP), false) !== undefined, down: app.get(key(K_DOWN), false) !== undefined },
    readableError: layer.getPluginError('s1.b'),
  });
  await layer.unloadPlugin('s1.b');
}

// ——————————————————————————————————————————————— S2：迟到的提供方
{
  const app = new Context({ name: 'poc04-s2' });
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const A = makeProbe({ id: 's2.a', provides: [K_UP], provideDelayMs: 200 });
  const B = makeProbe({ id: 's2.b', requires: [K_UP], provides: [K_DOWN] });

  const loadingA = layer.loadPlugin(A.definition); // 不 await：模拟宿主里的并发装载
  await sleep(20);
  const t0 = now();
  const stateB = await layer.loadPlugin(B.definition);
  const elapsedB = now() - t0;
  const midB = layer.getPluginState('s2.b');
  const stateA = await loadingA;
  await sleep(250);

  report.scenarios.push({
    name: 'S2 迟到的提供方',
    question: '提供方异步就绪后，先装载的依赖方是否自动激活',
    stateA,
    stateBWhenLoaded: stateB,
    loadBElapsedMs: elapsedB,
    stateBRightAfterLoad: midB,
    stateBAfterProviderReady: layer.getPluginState('s2.b'),
    bSetupCount: B.obs.setupEnd > 0 ? 1 : 0,
    bTicksBeforeActivation: B.obs.tickCount,
    host: { up: app.get(key(K_UP), false) !== undefined, down: app.get(key(K_DOWN), false) !== undefined },
  });
  await layer.unloadPlugin('s2.b');
  await layer.unloadPlugin('s2.a');
}

// ——————————————————————————————————————————————— S3：setup 中途 provider 消失
{
  const app = new Context({ name: 'poc04-s3' });
  const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });
  const A = makeProbe({ id: 's3.a', provides: [K_UP] });
  const B = makeProbe({ id: 's3.b', requires: [K_UP], provides: [K_DOWN], setupDelayMs: 300 });

  await layer.loadPlugin(A.definition);
  const t0 = now();
  const loadingB = layer.loadPlugin(B.definition);
  await sleep(100); // B 的 setup 还在 300 ms 的等待里
  const stateBDuringSetup = layer.getPluginState('s3.b');
  await layer.unloadPlugin('s3.a');
  const stateBRightAfterProviderGone = layer.getPluginState('s3.b');
  let loadBOutcome;
  try {
    loadBOutcome = await loadingB;
  } catch (error) {
    loadBOutcome = `threw:${error?.name ?? error}`;
  }
  await sleep(400);
  const stateBFinal = layer.getPluginState('s3.b');

  // 再发一次事件，看订阅者是否还挂在那儿
  const subBefore = B.obs.subscriberCalls;
  await app.parallel(key(K_EVENT), { trigger: 's3-after-abort' });

  report.scenarios.push({
    name: 'S3 provider 在 setup 中途消失',
    question: '下游异步 setup 期间提供方卸载，激活/清理/最终状态是否正确',
    stateBDuringSetup,
    stateBRightAfterProviderGone,
    loadBReturned: loadBOutcome,
    stateBFinal,
    bSetupCompleted: B.obs.setupEnd > 0 && B.obs.setupEnd >= B.obs.setupStart,
    bCleanupCount: B.obs.cleanupCount,
    bTimersLeft: B.obs.timers,
    bTicksAfterAbort: B.obs.tickCount,
    bSubscriberCallsFromOneEmit: B.obs.subscriberCalls - subBefore,
    host: { up: app.get(key(K_UP), false) !== undefined, down: app.get(key(K_DOWN), false) !== undefined },
    elapsedMs: now() - t0,
  });
  await layer.unloadPlugin('s3.b');
}

writeFileSync(resolve(here, 'race.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.scenarios, null, 2));
