// The executor, as a plugin.
//
// The human who types an instruction reaches this plugin over its own endpoint; that is a client, and it
// is not a reason to register anything. Nothing inside the composition asks this plugin for a change yet,
// so **this plugin provides nothing** — and the emptiness is a decision rather than an omission, the same
// one `changeable-repositories` recorded before its reader arrived: a contract published for a consumer
// that does not exist is what `plugin-design-spec.md` §16 refuses. The trigger to watch for is a caller
// inside the composition that needs a change made and is not this plugin's own CLI.
//
// It requires two things and writes one of them. `changeable-repositories.read@1` is the declaration set:
// the range check happens against it before anything starts, and a repository that is not in it is a
// halt, not a judgement call. Chronicle is the record: this plugin is the semantic owner of "the executor
// was asked to change a repository" and "this is how it ended", so it admits both facts itself rather
// than inventing an Event for something only it is entitled to assert.
//
// The model arrives as a *factory*, not as a connection and not as configuration. That is deliberate and
// it is the same shape `src/language/plugin.ts` uses: the composition root decides what a model is and
// where it comes from — in the resident, the two flags that already exist for Language — while this
// plugin decides what to do with one. A build with no model wired at all still activates, still listens,
// and answers every instruction with `executor-unavailable`: the failure is a fact about the deployment,
// and the person standing at the pipe is the one who needs to hear it.
//
// The endpoint exists for exactly as long as this plugin is activated — no longer — and that is what makes
// the resource story simple: created in `setup`, closed by a `context.defer` cleanup, owned by the
// mechanism that exists for owning it.

import { changeableRepositoriesReadService } from '../changeable-repositories/index.js';
import { chronicleService } from '../chronicle/index.js';
import type { DurableFact, FactDraft } from '../chronicle/types.js';
import type { LanguageModel } from '../language/model.js';
import type { PluginDefinition } from '../runtime/plugin.js';

import { listenRepositoryChangeEndpoint } from './endpoint.js';
import { repositoryChangeEndpointPath } from './endpoint-path.js';
import { RepositoryChangeError } from './errors.js';
import { executeRepositoryChange } from './execute.js';
import type { GitBudgets } from './git.js';
import { createRepositoryChangeRunner } from './loop.js';

/** How long one run may take, when the composition does not say otherwise. */
export const DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

export interface RepositoryChangeExecutorOptions {
  readonly dataDir: string;
  /**
   * Builds the model this executor drives, already bound to an endpoint, or absent when the deployment
   * wired no model at all. Absent is a supported deployment: every run ends `executor-unavailable`.
   */
  readonly createModel?: (() => LanguageModel) | undefined;
  readonly runTimeoutMs?: number | undefined;
  readonly budgets?: GitBudgets | undefined;
  /** How `read_ci` is answered, when the deployment chose to wire one in. */
  readonly readCi?: (() => Promise<string>) | undefined;
}

export function createRepositoryChangeExecutorPlugin(
  options: RepositoryChangeExecutorOptions,
): PluginDefinition {
  return {
    id: 'repository-change-executor',
    version: '1.0.0',
    requires: [changeableRepositoriesReadService, chronicleService],
    provides: [],
    async setup(context) {
      const path = repositoryChangeEndpointPath(options.dataDir);
      if (path === undefined) {
        // The ingress is a named pipe and a host without a pipe namespace has nowhere to put it. Same
        // shape as the authorization's: whether an implementation can work on this host is ownership's
        // business, not every consumer's.
        throw new RepositoryChangeError('执行者入口依赖 Windows 命名管道，本机没有。');
      }

      // Pulled once, at activation, and held for the activation — the same lifetime the endpoint has.
      const read = context.services.get(changeableRepositoriesReadService);
      const chronicle = context.services.get(chronicleService);

      const runner =
        options.createModel === undefined
          ? undefined
          : createRepositoryChangeRunner(options.createModel(), {
              // Spread rather than assigned, because `exactOptionalPropertyTypes` tells "this option is
              // absent" apart from "this option is present and undefined", and only the first of those
              // means what is intended here.
              ...(options.readCi === undefined ? {} : { readCi: options.readCi }),
              ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
            });

      const endpoint = await listenRepositoryChangeEndpoint(
        {
          handle: async (request) => {
            // The runner is what decides whether anything can move; this handler only decides what the
            // person is told. `executeRepositoryChange` answers rather than throws, and the catch below is
            // for the day that stops being true — a broken promise ends one conversation, not the process,
            // and it is reported in the plugin's own voice rather than inventing a failure in a host's.
            try {
              const execution = await executeRepositoryChange({
                request,
                read,
                runner,
                runTimeoutMs: options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
                ...(options.budgets === undefined ? {} : { budgets: options.budgets }),
              });

              const recorded = await record(chronicle, execution.facts);
              return {
                // Only a change that happened is success. "Nothing changed" and "we cannot tell" are both
                // answers to the person, and both leave the world as it was — but neither is the thing that
                // was asked for, so the exit code says so.
                outcome: execution.result.outcome === 'changed' ? 'ok' : 'failed',
                lines: recorded === undefined ? execution.result.lines : [...execution.result.lines, recorded],
              };
            } catch (error) {
              const detail = error instanceof Error && error.message !== '' ? error.message : String(error);
              return { outcome: 'failed', lines: [`这次请求没有走完：${detail}`] };
            }
          },
        },
        path,
      );

      context.defer(() => endpoint.close());
    },
  };
}

/**
 * Writes the facts this run produced, in the order they were produced, and reports a failure as a line
 * rather than as an exception.
 *
 * The mandate fact is written *before* the run and the result fact after it, but both reach here at the
 * same moment — a run that never started writes only the second one, and the first is the record that
 * the person asked at all. A record that refuses a write does not undo the change: if the executor moved
 * the world and the pen broke, the honest thing to say is that the change happened and the record of it
 * did not.
 */
async function record(
  chronicle: { append(draft: FactDraft): Promise<DurableFact> },
  facts: readonly FactDraft[],
): Promise<string | undefined> {
  for (const fact of facts) {
    try {
      await chronicle.append(fact);
    } catch (error) {
      const detail = error instanceof Error && error.message !== '' ? error.message : String(error);
      return `这条记录没能写进事实史（${fact.type}）：${detail}`;
    }
  }
  return undefined;
}
