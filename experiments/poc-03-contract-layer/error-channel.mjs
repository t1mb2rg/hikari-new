// PoC-03 / s1：Cordis 4.0.5 到底把 setup 失败的错误对象放在哪几条通道上。
//
// 任务书要求「先观察，后决定是否补自己的错误记录」。所以这里只观察，不实现适配层。
// 四条通道各测一遍：internal/status 事件、fiber.await()、fiber 的公开属性、logger。
//
// 运行：node experiments/poc-03-contract-layer/error-channel.mjs
// 依赖：DSH 已安装在 DSH_ROOT（默认沿用 PoC-01 的隔离目录）。

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);

const out = {
  cordis: null,
  channels: {},
  verdict: {},
};

// ---------------------------------------------------------------- 夹具

class BoomA extends Error {
  constructor() {
    super('setup exploded on purpose');
    this.name = 'BoomA';
    this.marker = { code: 'E_POC03_SETUP', at: 'poc-03' };
  }
}

const failing = {
  name: 'poc03-failing',
  apply(ctx) {
    throw new BoomA();
  },
};

const healthy = {
  name: 'poc03-healthy',
  apply(ctx) {
    ctx.effect(() => () => {});
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把一个东西压成可 JSON 化的形状，避免循环引用。 */
const shape = (value) => {
  if (value === undefined) return { type: 'undefined' };
  if (value === null) return { type: 'null' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { type: typeof value, value };
  }
  const entry = { type: typeof value, ctor: value?.constructor?.name ?? null };
  if (value instanceof Error) {
    entry.name = value.name;
    entry.message = value.message;
    entry.hasMarker = Boolean(value.marker);
    entry.marker = value.marker ?? null;
  }
  return entry;
};

// ---------------------------------------------------------------- 通道 1：internal/status

{
  const app = new Context();
  out.cordis = app.constructor?.version ?? null;

  const statusEvents = [];
  const pluginEvents = [];
  const loggerErrors = [];

  // 公开接口里能挂的三个监听，全部挂上，看各自收到什么。
  app.on('internal/status', (...args) => {
    const [fiber, oldState] = args;
    statusEvents.push({
      argCount: args.length,
      argKinds: args.map((a) => typeof a),
      oldState,
      newState: fiber?.state ?? null,
      fiberUid: fiber?.uid ?? null,
      // 关键：事件参数里有没有错误对象
      carriesError: args.some((a) => a instanceof Error),
      // fiber 自己身上读不读得到
      fiberOwnKeys: fiber ? Object.keys(fiber) : null,
      fiberErrorField: fiber && 'error' in fiber ? shape(fiber.error) : 'absent',
      fiberUnderscoreError: fiber && '_error' in fiber ? shape(fiber._error) : 'absent',
      readErrorAtEventTime: (() => {
        try {
          return shape(fiber?.error);
        } catch (e) {
          return { threw: String(e) };
        }
      })(),
    });
  });

  app.on('internal/plugin', (...args) => {
    pluginEvents.push({ argCount: args.length, argKinds: args.map((a) => typeof a) });
  });

  // logger 也是一条可能的通道：_reload 的 catch 里先 ctx.logger.error(reason)。
  if (app.logger && typeof app.logger.error === 'function') {
    const original = app.logger.error.bind(app.logger);
    app.logger.error = (...args) => {
      loggerErrors.push(args.map(shape));
      return original(...args);
    };
  }

  const fiber = app.plugin(failing);
  await sleep(50);

  let awaitThrew = null;
  let awaitFirst = null;
  let awaitSecond = null;
  try {
    await fiber.await();
    awaitFirst = 'returned-normally';
  } catch (error) {
    awaitFirst = 'threw';
    awaitThrew = shape(error);
  }
  // 同一个 fiber 再 await 一次，看错误是否还在（可重复读取的关键）
  try {
    await fiber.await();
    awaitSecond = 'returned-normally';
  } catch (error) {
    awaitSecond = { threw: shape(error) };
  }

  const awaitHasMarker = (() => {
    let marker = null;
    try {
      // 再拿一次，检查 marker 是否原样保留
      const f2 = app.plugin({ name: 'poc03-probe2', apply(ctx) { throw new BoomA(); } });
      return { note: 'see awaitSecond' };
    } catch {
      return null;
    }
  })();

  out.channels.status = {
    events: statusEvents,
    eventCount: statusEvents.length,
    anyEventCarriedError: statusEvents.some((e) => e.carriesError),
  };
  out.channels.pluginEvent = { events: pluginEvents, eventCount: pluginEvents.length };
  out.channels.logger = {
    calls: loggerErrors,
    callCount: loggerErrors.length,
    carriedErrorObject: loggerErrors.some((args) => args.some((a) => a.name === 'BoomA')),
  };
  out.channels.await = {
    first: awaitFirst,
    firstError: awaitThrew,
    second: awaitSecond,
    repeatable: awaitSecond !== 'returned-normally',
  };

  // -------------------------------------------------------------- 通道 3：fiber 的公开属性
  const ownKeys = Object.getOwnPropertyNames(fiber);
  const proto = Object.getPrototypeOf(fiber);
  const protoMembers = proto ? Object.getOwnPropertyNames(proto) : [];
  const errorLike = [...ownKeys, ...protoMembers].filter((k) => /error/i.test(k));
  out.channels.fiberObject = {
    ownKeys,
    protoMembers,
    errorLikeMembers: errorLike,
    // 逐个读一下 error 相关成员，看有没有能用的 getter
    errorMemberReads: errorLike.map((k) => {
      try {
        const v = fiber[k];
        return { key: k, kind: typeof v, shape: typeof v === 'function' ? 'function' : shape(v) };
      } catch (error) {
        return { key: k, threw: String(error) };
      }
    }),
    stateAfterFail: fiber.state,
    uidAfterFail: fiber.uid,
  };

  await app.registry?.delete?.(fiber.callback);
  try { await fiber.dispose(); } catch { /* already failed */ }

  // 第二条试验：健康插件，确认 status 事件在没有错误时也是同样的形状
  const app2 = new Context();
  const healthyStatus = [];
  app2.on('internal/status', (...args) => {
    healthyStatus.push({ argCount: args.length, oldState: args[1], newState: args[0]?.state ?? null });
  });
  const f2 = app2.plugin(healthy);
  await sleep(50);
  try { await f2.await(); } catch { /* ignore */ }
  out.channels.statusHealthy = { events: healthyStatus, awaitResult: 'no-throw' };
  try { await f2.dispose(); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- 判定

const statusOk = out.channels.status.anyEventCarriedError === false;
const awaitOk = out.channels.await.first === 'threw' && out.channels.await.repeatable === true;
const getterOk = out.channels.fiberObject.errorMemberReads.some(
  (r) => r.kind !== 'undefined' && r.shape !== 'absent',
);

out.verdict = {
  statusEventCarriesError: out.channels.status.anyEventCarriedError,
  awaitRethrows: out.channels.await.first === 'threw',
  awaitRepeatable: out.channels.await.repeatable,
  publicErrorGetterUsable: getterOk,
  loggerCarriesErrorObject: out.channels.logger.carriedErrorObject,
  conclusion: {
    statusEventAloneSufficient: !statusOk,
    awaitSufficient: awaitOk,
    // 适配层要不要自存
    adapterMustStore: awaitOk === false,
  },
};

writeFileSync(resolve(here, 'error-channel.json'), `${JSON.stringify(out, null, 2)}\n`);

// ---------------------------------------------------------------- 打印

console.log('Cordis:', out.cordis);
console.log('');
console.log('internal/status 事件数:', out.channels.status.eventCount);
for (const e of out.channels.status.events) {
  console.log(
    `  status: ${e.oldState} -> ${e.newState}  参数数=${e.argCount} 带错误对象=${e.carriesError}  ` +
      `fiber.error=${JSON.stringify(e.fiberErrorField)}  _error=${JSON.stringify(e.fiberUnderscoreError)}`,
  );
}
console.log('');
console.log('fiber.await() 第一次:', out.channels.await.first, JSON.stringify(out.channels.await.firstError));
console.log('fiber.await() 第二次:', JSON.stringify(out.channels.await.second));
console.log('');
console.log('fiber 公开属性:', out.channels.fiberObject.ownKeys.join(', '));
console.log('原型成员:', out.channels.fiberObject.protoMembers.join(', '));
console.log('error 相关成员:', out.channels.fiberObject.errorLikeMembers.join(', ') || '(无)');
console.log('');
console.log('logger.error 调用:', out.channels.logger.callCount, '带原错误对象=', out.channels.logger.carriedErrorObject);
console.log('');
console.log('判定:', JSON.stringify(out.verdict.conclusion));
