// PoC-01 / s4：DSH 插件 —— 把 Hikari 的 desktop-session-awareness.peek 暴露成模型工具。
//
// 这个文件同时做两件事：
//   1. 用 adapter.mjs 把 Hikari 的四层领域插件装载进当前 Cordis 上下文（真实现，import 自 dist/）；
//   2. 等 peek 服务真的可用之后，把一个只读工具 peek_desktop 注册到 ctx.tools。
//
// 除 peek_desktop 之外不注册任何工具；不提供 shell、写文件、git 能力。

import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { toCordisPlugin, serviceName } from './adapter.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.HIKARI_REPO ?? 'G:/work/LAB/code/projects/own/hikari-new';
const DSH_ROOT = process.env.DSH_ROOT ?? 'G:/work/LAB/code/_poc/poc01';

const HIKARI = (p) => pathToFileURL(resolve(REPO, 'dist', p)).href;
const foreground = await import(HIKARI('foreground/index.js'));
const inputActivity = await import(HIKARI('input-activity/index.js'));
const world = await import(HIKARI('desktop-session-world/index.js'));
const awareness = await import(HIKARI('desktop-session-awareness/index.js'));

const dshRequire = createRequire(`${DSH_ROOT}/package.json`);
const { defineTool } = await import(pathToFileURL(dshRequire.resolve('@deepseek-ai/dsh-tools')).href);

const LAYERS = [
  foreground.foregroundPlugin,
  inputActivity.inputActivityPlugin,
  world.desktopSessionWorldPlugin,
  awareness.desktopSessionAwarenessPlugin,
];
const PEEK = serviceName(awareness.desktopSessionAwarenessPeekService);

const plugin = {
  name: 'poc01-hikari-peek',
  inject: ['tools'],

  apply(ctx) {
    // 1) 真 Hikari 领域实现进 Cordis
    for (const def of LAYERS) ctx.plugin(toCordisPlugin(def).plugin);

    // 2) 等 peek 真的可用，再注册工具（服务起不来时工具就不存在）
    ctx.inject([PEEK], (inner) => {
      inner.tools.register(defineTool({
        name: 'peek_desktop',
        description:
          'Read the current desktop session state: which window/application is in the foreground '
          + 'and whether the user has produced input recently. Read-only; it changes nothing and '
          + 'does not record a new comparison baseline. Call it when you need to know what the user '
          + 'is doing right now.',
        parameters: {},
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute() {
          const peek = inner.get(PEEK, false);
          if (!peek) throw new Error('desktop-session-awareness.peek is not available');
          const assessment = await peek.peek();
          return JSON.stringify(assessment);
        },
      }));
    });
  },
};

export default plugin;
