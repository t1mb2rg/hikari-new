// s3：真实 human-delivery 插件在契约层下的投递、资源关闭与重新装载。
//
// 这是链上第一个**带真实副作用**的领域插件：它的 setup 会在 Windows 命名管道命名空间里真的建一个监听。
// 全部动作都在隔离的临时目录里发生，客户端是本脚本自己的受控测试客户端，
// 不向任何真实用户终端或外部服务投递。
//
// 关键源码：
//   config.parse           src/human-delivery/plugin.ts:32-43
//   管道名推导             src/human-delivery/endpoint-path.ts:27-36
//   setup 里的监听与 defer  src/human-delivery/plugin.ts:53-74
//   三态投递               src/human-delivery/endpoint.ts:97-140、src/human-delivery/types.ts
//   消息帧（一行 JSON 数组） src/human-delivery/protocol.ts:31-33
//
// 运行：node experiments/route-c-first-domain/human-delivery.mjs
// 依赖：hikari-new 已 `npm run build`；DSH 已装在 DSH_ROOT。

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const HIKARI = (p) => pathToFileURL(resolve(repo, 'dist', p)).href;
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';
const CORDIS = pathToFileURL(`${DSH_ROOT}/node_modules/@deepseek-ai/cordis/lib/index.js`).href;

const { Context } = await import(CORDIS);
const delivery = await import(HIKARI('human-delivery/index.js'));
const { humanDeliveryEndpointPath } = await import(HIKARI('human-delivery/endpoint-path.js'));
const { createContractLayer, loadHikariValidator, contractKey } = await import(
  pathToFileURL(resolve(repo, 'experiments/poc-03-contract-layer/contract-layer.mjs')).href
);

const validateDefinition = await loadHikariValidator(repo);
const rootDir = mkdtempSync(join(tmpdir(), 'poc-first-domain-delivery-'));
const pipePath = humanDeliveryEndpointPath(rootDir);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 受控测试客户端：连上就把收到的字节累积起来，按换行切帧。 */
function openClient(path) {
  return new Promise((done, fail) => {
    const socket = connect(path);
    const frames = [];
    let buffer = '';
    let closed = false;
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        frames.push(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    });
    socket.on('close', () => {
      closed = true;
    });
    socket.on('error', () => socket.destroy());
    socket.once('connect', () =>
      done({
        socket,
        frames,
        state: () => ({ closed, frameCount: frames.length, frames: [...frames] }),
        close: () => socket.destroy(),
      }),
    );
    socket.once('error', fail);
    setTimeout(() => fail(new Error('connect timeout')), 5000).unref?.();
  });
}

/** 连接一个不该存在的管道：拿回错误码。 */
function tryConnect(path) {
  return new Promise((done) => {
    const socket = connect(path);
    socket.once('connect', () => {
      socket.destroy();
      done({ connected: true });
    });
    socket.once('error', (error) => done({ connected: false, code: error.code, message: error.message }));
  });
}

const app = new Context();
const layer = createContractLayer(app, { validateDefinition });
const serviceKey = contractKey(delivery.humanDeliveryService);
const deliver = async (lines) => {
  const service = app.get(serviceKey, false);
  if (!service) throw new Error(`service not resolvable: ${serviceKey}`);
  return service.deliver(lines);
};

const report = {
  frozenAt: new Date().toISOString(),
  rootDir,
  pipePath,
  serviceKey,
  steps: {},
};

// —— 1 装载
report.steps.load = {
  state: await layer.loadPlugin(delivery.humanDeliveryPlugin, { rootDir }),
  stateAfter: layer.getPluginState(delivery.humanDeliveryPlugin.id),
};
console.log('装载：', report.steps.load.stateAfter, '| 管道', pipePath);

// —— 2 没人连接时投递
report.steps.noClient = await deliver(['头一行', '第二行']);
console.log('无人连接投递：', JSON.stringify(report.steps.noClient));

// —— 3 客户端连上之后投递
const client = await openClient(pipePath);
// 客户端 socket 的 'connect' 与服务端 'connection' 回调不保证同一 tick；等一拍再投递。
await sleep(150);
const lines = ['Repository CI attention：t1mb2rg/hikari-new', '结论：failure', '观察时间：2026-10-28T12:00:00Z'];
report.steps.withClient = await deliver(lines);
await sleep(200);
report.steps.clientReceived = client.state();
report.steps.framesMatchInput =
  report.steps.clientReceived.frames.length === 1 &&
  JSON.stringify(JSON.parse(report.steps.clientReceived.frames[0])) === JSON.stringify(lines);
console.log('连接后投递：', JSON.stringify(report.steps.withClient), '| 收到', report.steps.clientReceived.frameCount, '帧，逐字相等 =', report.steps.framesMatchInput);

// —— 4 第二个客户端应该被拒绝
const second = connect(pipePath);
const secondOutcome = await new Promise((done) => {
  let gotData = false;
  second.on('data', () => {
    gotData = true;
  });
  second.once('close', () => done({ gotData, closedByHost: true }));
  second.once('error', (error) => done({ gotData, error: error.code }));
  setTimeout(() => {
    second.destroy();
    done({ gotData, closedByHost: false, timedOut: true });
  }, 800).unref?.();
});
report.steps.secondClient = secondOutcome;
console.log('第二客户端：', JSON.stringify(secondOutcome));

// —— 4.5 写不进去时应当是 failed：客户端连上但不读，灌满管道缓冲
client.close();
await sleep(150);
const stalled = await openClient(pipePath);
stalled.socket.pause();
await sleep(150);
const flood = Array.from({ length: 60 }, (_, i) => `line-${i}-` + 'x'.repeat(60000));
const floodStarted = Date.now();
report.steps.stalledWrite = { ...(await deliver(flood)), elapsedMs: Date.now() - floodStarted, lines: flood.length };
stalled.close();
console.log('客户端不读时投递：', JSON.stringify(report.steps.stalledWrite));
await sleep(150);

// —— 5 卸载：管道应当消失，已连接的客户端应当被挂断
await layer.unloadPlugin(delivery.humanDeliveryPlugin.id);
await sleep(150);
report.steps.afterUnload = {
  state: layer.getPluginState(delivery.humanDeliveryPlugin.id) ?? '(无记录)',
  serviceResolvable: app.get(serviceKey, false) !== undefined,
  clientClosed: client.state().closed,
  reconnect: await tryConnect(pipePath),
};
console.log('卸载后：', JSON.stringify(report.steps.afterUnload));

// —— 6 重新装载并再投递一次
report.steps.reload = {
  state: await layer.loadPlugin(delivery.humanDeliveryPlugin, { rootDir }),
  stateAfter: layer.getPluginState(delivery.humanDeliveryPlugin.id),
};
const client2 = await openClient(pipePath);
await sleep(150);
report.steps.reloadDeliver = await deliver(['重装之后的一行']);
await sleep(200);
report.steps.reloadClientReceived = client2.state();
console.log('重装后：', report.steps.reload.stateAfter, '| 投递', JSON.stringify(report.steps.reloadDeliver), '| 收到', client2.state().frameCount, '帧');

// —— 7 收尾
client2.close();
await layer.unloadPlugin(delivery.humanDeliveryPlugin.id);
await sleep(100);
report.steps.teardown = { reconnect: await tryConnect(pipePath) };
try {
  rmSync(rootDir, { recursive: true, force: true });
} catch {
  /* 临时目录清理失败不影响读数 */
}

writeFileSync(resolve(here, 'human-delivery.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log('\n=== 汇总 ===');
console.log(JSON.stringify(report.steps, null, 2).slice(0, 1600));
