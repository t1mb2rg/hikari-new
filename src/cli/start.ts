import { ChronicleNotInitializedError, chroniclePlugin } from '../chronicle/index.js';
import { NotInitializedError, continuityPlugin } from '../continuity/index.js';
import { Runtime } from '../index.js';
import type { PluginState } from '../index.js';
import {
  CHRONICLE_INIT_HINT,
  INIT_HINT,
  type CliOptions,
  type CommandOutcome,
} from './options.js';

export async function startCommand(options: CliOptions): Promise<CommandOutcome> {
  const runtime = new Runtime();
  try {
    const continuityState = await runtime.loadPlugin(continuityPlugin, {
      rootDir: options.dataDir,
    });
    const chronicleState = await runtime.loadPlugin(chroniclePlugin, {
      rootDir: options.dataDir,
    });
    return readStartup(continuityState, chronicleState, runtime);
  } finally {
    await runtime.shutdown();
  }
}

function readStartup(
  continuityState: PluginState,
  chronicleState: PluginState,
  runtime: Runtime,
): CommandOutcome {
  const states = [
    `continuity 状态：${continuityState}`,
    `chronicle 状态：${chronicleState}`,
  ];

  if (continuityState === 'active' && chronicleState === 'active') {
    return { exitCode: 0, stdout: render(['Hikari 启动成功。', ...states]), stderr: '' };
  }

  if (continuityState !== 'active') {
    const error = runtime.getPluginError(continuityPlugin.id);
    const failure = ['Hikari 未启动：无法确认长期主体。', ...states, describeError(error)];
    if (error instanceof NotInitializedError) failure.push(INIT_HINT);
    return { exitCode: 1, stdout: '', stderr: render(failure) };
  }

  const error = runtime.getPluginError(chroniclePlugin.id);
  const failure = [
    'Hikari 未启动：长期主体已恢复，但事实史不可用。',
    ...states,
    describeError(error),
  ];
  if (error instanceof ChronicleNotInitializedError) failure.push(CHRONICLE_INIT_HINT);
  return { exitCode: 1, stdout: '', stderr: render(failure) };
}

function render(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}

function describeError(error: unknown): string {
  if (error === undefined) return '插件没有记录到错误。';
  return error instanceof Error ? error.message : String(error);
}
