// PoC-04 / 收口验证 A：用最终适配层重跑 PoC-02 的五项 Event 测试。
//
// 五项与 PoC-02 同名同义（不新增事件机制）：
//   E1 等待    发布者是否等订阅者完成
//   E2 并发    多个订阅者是否并发
//   E3 聚合    订阅者抛错是否聚合成 AggregateError（带 message 与 errors）
//   E4 退订    unloadPlugin 之后是否不再收到
//   E5 重装    重新装载后是否恢复接收，且一次 emit 只收到一次（无重复订阅）
//
// 与 PoC-02 的差别只在被测对象：那里用的是 adapter-events.mjs（PoC-02 的临时桥），
// 这里用 PoC-03 的 contract-layer.mjs（最终适配层）。
//
// 运行：node experiments/poc-04-cascade-lifecycle/event-final.mjs

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

// 真实 Hikari 事件契约
const K_EVENT = Object.freeze({ id: 'desktop-session-awareness-loop.assessed', version: 1 });
const NAME = `${K_EVENT.id}@${K_EVENT.version}`;

const app = new Context({ name: 'poc04-events' });
const layer = createContractLayer(app, { validateDefinition: validatePluginDefinition });

const result = { generatedAt: new Date().toISOString(), node: process.version, event: NAME, cases: {} };

// ————————————————————————————————————————— E1 / E2：等待与并发
{
  const marks = { starts: [], ends: [], subscriberCalls: 0 };
  const makeSub = (id, delayMs) => ({
    id,
    version: '1',
    setup(context) {
      context.events.on(K_EVENT, async (payload) => {
        marks.starts.push({ id, n: payload?.n, at: now() });
        marks.subscriberCalls += 1;
        await sleep(delayMs);
        marks.ends.push({ id, n: payload?.n, at: now() });
      });
    },
  });

  const subA = makeSub('e1.sub-a', 300);
  const subB = makeSub('e1.sub-b', 300);

  // 关键：必须等上一次 emit 完成再排下一次，否则测的是 setInterval 的节奏而不是事件语义。
  const marks2 = { emittedAt: [] };
  const publisher = {
    id: 'e1.publisher',
    version: '1',
    setup(context) {
      let count = 0;
      let timer;
      const tick = async () => {
        if (count >= 2) return;
        count += 1;
        marks2.emittedAt.push(now());
        try {
          await context.events.emit(K_EVENT, { n: count });
        } catch {
          /* E3 单独测 */
        }
        timer = setTimeout(tick, 100);
        timer.unref?.();
      };
      timer = setTimeout(tick, 100);
      timer.unref?.();
      return () => clearTimeout(timer);
    },
  };

  await layer.loadPlugin(subA);
  await layer.loadPlugin(subB);
  await layer.loadPlugin(publisher);
  await sleep(1200);
  await layer.unloadPlugin('e1.publisher');
  await layer.unloadPlugin('e1.sub-a');
  await layer.unloadPlugin('e1.sub-b');

  const gaps = marks2.emittedAt.slice(1).map((t, i) => t - marks2.emittedAt[i]);
  const startsByEmit = [...new Set(marks.starts.map((s) => s.n))].map((n) => {
    const list = marks.starts.filter((s) => s.n === n);
    return {
      emitIndex: n,
      subscribers: list.map((x) => x.id),
      startDeltaMs: list.length > 1 ? Math.max(...list.map((x) => x.at)) - Math.min(...list.map((x) => x.at)) : 0,
    };
  });

  result.cases.E1_waits = {
    emitGapsMs: gaps,
    waitsForSubscribers: gaps.length > 0 && gaps.every((g) => g >= 300),
    note: '订阅者各睡 300 ms、发布间隔 100 ms；若等待，间隔应 ≥ 400 ms',
  };
  result.cases.E2_concurrent = {
    emits: startsByEmit,
    concurrent: startsByEmit.length > 0 && startsByEmit.every((g) => g.startDeltaMs < 50),
  };
}

// ————————————————————————————————————————— E3：失败聚合
{
  const obs = { thrown: null };
  const failing = {
    id: 'e3.failing',
    version: '1',
    setup(context) {
      context.events.on(K_EVENT, () => {
        throw new Error('boom-a');
      });
      context.events.on(K_EVENT, () => {
        throw new Error('boom-b');
      });
    },
  };
  const publisher = {
    id: 'e3.publisher',
    version: '1',
    setup(context) {
      obs.emit = async () => context.events.emit(K_EVENT, { trigger: 'e3' });
    },
  };

  await layer.loadPlugin(failing);
  await layer.loadPlugin(publisher);
  // 走适配层的事件桥：取发布者的 context 不方便，改用宿主并行 + 手工判定会失真，
  // 所以这里让发布者在 setup 里把 emit 函数存到 obs，再显式调用。
  try {
    await obs.emit();
  } catch (error) {
    obs.thrown = {
      name: error?.name,
      message: error?.message,
      isAggregateError: error instanceof AggregateError,
      errors: error instanceof AggregateError ? error.errors.map((e) => e?.message) : undefined,
    };
  }
  await layer.unloadPlugin('e3.publisher');
  await layer.unloadPlugin('e3.failing');
  result.cases.E3_aggregated = {
    thrown: obs.thrown,
    aggregated: obs.thrown?.isAggregateError === true,
    hasMessage: obs.thrown?.message === `Event ${NAME} had failing subscribers.`,
  };
}

// ————————————————————————————————————————— E4 / E5：退订与重装
{
  const obs = { calls: 0 };
  const sub = {
    id: 'e4.sub',
    version: '1',
    setup(context) {
      context.events.on(K_EVENT, () => {
        obs.calls += 1;
      });
    },
  };

  await layer.loadPlugin(sub);
  await app.parallel(NAME, { n: 'before-unload' });
  const afterFirst = obs.calls;

  await layer.unloadPlugin('e4.sub');
  await app.parallel(NAME, { n: 'after-unload' });
  const afterUnload = obs.calls;

  await layer.loadPlugin(sub);
  await app.parallel(NAME, { n: 'after-reload' });
  const afterReload = obs.calls;

  result.cases.E4_unsubscribed = {
    callsAfterFirstEmit: afterFirst,
    callsAfterUnload: afterUnload,
    unsubscribed: afterUnload === afterFirst,
  };
  result.cases.E5_reload = {
    callsAfterReload: afterReload,
    receivedExactlyOnce: afterReload - afterUnload === 1,
    reloaded: afterReload > afterUnload,
  };
  await layer.unloadPlugin('e4.sub');
}

result.verdict = {
  E1: result.cases.E1_waits.waitsForSubscribers ? 'PASS' : 'FAIL',
  E2: result.cases.E2_concurrent.concurrent ? 'PASS' : 'FAIL',
  E3: result.cases.E3_aggregated.aggregated && result.cases.E3_aggregated.hasMessage ? 'PASS' : 'FAIL',
  E4: result.cases.E4_unsubscribed.unsubscribed ? 'PASS' : 'FAIL',
  E5: result.cases.E5_reload.reloaded && result.cases.E5_reload.receivedExactlyOnce ? 'PASS' : 'FAIL',
};

writeFileSync(resolve(here, 'event-final.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
