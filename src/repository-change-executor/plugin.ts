// The executor, as a plugin.
//
// The human who types an instruction reaches this plugin over its own endpoint; that is a client, and it
// is not a reason to register anything. For its first slice this plugin provided **nothing**, and the
// emptiness was a decision rather than an omission — the same one `changeable-repositories` recorded
// before its reader arrived: a contract published for a consumer that does not exist is what
// `plugin-design-spec.md` §16 refuses.
//
// A consumer has since arrived, and it is not the one that note was watching for. That note read "a
// caller inside the composition that needs a change made"; the caller that came needs to *read* — it asks
// whether a commit a failing CI run ran against is one this executor pushed. The human confirmed that
// this is the same ruling applied to a second capability rather than the old trigger satisfied by
// word-play, and the L2 review (`docs/architecture/repository-change-history-readback-v0-boundary-review.md`)
// records the deviation in full. So this plugin now provides exactly one thing, and it is that question:
// one repository, one commit, one record or nothing. There is still **no way to make it do anything** —
// a mandate comes from a person's own sentence and from nowhere else.
//
// It requires two things and writes one of them. `changeable-repositories.read@1` is the declaration set:
// the range check happens against it before anything starts, and a repository that is not in it is a
// halt, not a judgement call. Chronicle is the record: this plugin is the semantic owner of "the executor
// was asked to change a repository" and "this is how it ended", so it admits both facts itself rather
// than inventing an Event for something only it is entitled to assert. Those two are requirements of
// every deployment; the third is described below, and it is conditional.
//
// The CI observation is *not* a third requirement for every deployment, and that is the whole reason this
// factory produces two definitions instead of one. A hard requirement would tie the executor's existence
// to a deployment having configured a repository to watch — measured on this machine, the members that
// load a resident with a CI requirement never came up at all when the deployment had none, and the price
// was the entire executor: silence at the pipe where an answer was owed. A deployment that *does* watch a
// repository requires, and reads, the CI observation; one that watches nothing requires only the two
// above. §8's fifth ruling is thereby satisfied where CI exists and honestly declined where it does not —
// the record says it could not be asked rather than leaving a blank.
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
import { gitHubCiService } from '../github-ci/index.js';
import type { LanguageModel } from '../language/model.js';
import type { PluginDefinition } from '../runtime/plugin.js';

import { repositoryChangeActionsService } from './contracts.js';
import { listenRepositoryChangeEndpoint } from './endpoint.js';
import { repositoryChangeEndpointPath } from './endpoint-path.js';
import { RepositoryChangeError } from './errors.js';
import { executeRepositoryChange } from './execute.js';
import type { GitBudgets } from './git.js';
import {
  findPushedCommit,
  type RepositoryChangeActionQuery,
  type RepositoryChangeActionRecord,
} from './history.js';
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
  /**
   * Whether this deployment watches a repository's CI, and therefore whether a run that pushed can name
   * the run that followed it.
   *
   * The composition root is the only place that knows this, so it is told rather than discovered: two
   * definitions come out of this factory and at most one of them is ever loaded. A deployment that gave
   * `--repository` loads the CI chain, and the executor it loads declares — and reads — the CI
   * observation. A deployment with no repository scope loads no CI plugin at all, and its executor must
   * still exist, because the person standing at the pipe is owed an answer either way.
   */
  readonly watchesCi?: boolean | undefined;
}

export function createRepositoryChangeExecutorPlugin(
  options: RepositoryChangeExecutorOptions,
): PluginDefinition {
  return {
    id: 'repository-change-executor',
    version: '1.0.0',
    // Two definitions, at most one of them loaded, and the composition root is what chooses: the
    // deployment that watches a repository loads this one after the CI plugin, and the one that watches
    // nothing loads the definition that requires nothing of CI. Everything else about them is identical.
    requires:
      options.watchesCi === true
        ? [changeableRepositoriesReadService, chronicleService, gitHubCiService]
        : [changeableRepositoriesReadService, chronicleService],
    // The one thing it publishes, and both definitions publish it: what differs between them is what
    // they *require* of CI, never what they offer. A deployment that watches no repository still has a
    // history worth asking about — the consumer's question is about commits, not about runs.
    provides: [repositoryChangeActionsService],
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

      // The one answer this plugin gives to anything but the person at the pipe. A named function with
      // its own signature rather than an inline method, for the reason the other providers in this
      // repository give: the contract's type has to reach the parameter, and an inline method inside
      // `Object.freeze` does not give the compiler the context to check it.
      //
      // A store that cannot be read is reported as "my record does not say so" and never as an exception.
      // This reader exists so that one judgement can be better informed; a chronicle that will not open
      // must not become the reason that judgement fails. What it must not do is answer "no" — the answer
      // is a record or nothing, and the caller falls back to what it would have said with no history at
      // all. The asymmetry is the same one the rest of this path takes: toward speaking, never silence.
      async function pushedCommit(
        query: RepositoryChangeActionQuery,
      ): Promise<RepositoryChangeActionRecord | undefined> {
        try {
          return findPushedCommit(await chronicle.read(), query);
        } catch {
          return undefined;
        }
      }

      context.services.provide(repositoryChangeActionsService, Object.freeze({ pushedCommit }));

      // The CI observation, on the one definition the composition loads for a deployment that watches a
      // repository. Both readings come from the same service and are wired together or not at all: the
      // number that goes in the record is read here, from outside the run's own account, which is what
      // §8's fifth ruling asks for; the model's `read_ci` tool is answered from the same observation
      // because a model asking is a different question from the record being complete, and neither is
      // answered by the executor's own account of itself.
      const ci = options.watchesCi === true ? context.services.get(gitHubCiService) : undefined;

      // What the record gets: the run's id, or nothing when the repository has no runs to name. A read
      // that throws is caught by `executeRepositoryChange`, which leaves the number absent rather than
      // inventing one — this reader's job is to report what was seen, not to decide what it means.
      const readCiRun =
        ci === undefined
          ? undefined
          : async (): Promise<number | undefined> => {
              const observation = await ci.current();
              return observation.latestRun.kind === 'reported' ? observation.latestRun.run.id : undefined;
            };

      // What the model gets: the same observation, said in the words the tool table already speaks. The
      // repository named is GitHub's own spelling of the one it was asked about, and whether that is the
      // repository this work tree pushes to is the composition's declaration, not this file's to check.
      const describeCi =
        ci === undefined
          ? undefined
          : async (): Promise<string> => {
              const observation = await ci.current();
              const latest = observation.latestRun;
              return latest.kind === 'reported'
                ? `${observation.repository} 最新一次 CI：${latest.run.workflow} #${latest.run.id}（${latest.run.status}）。`
                : `${observation.repository} 没有 CI 记录。`;
            };

      const runner =
        options.createModel === undefined
          ? undefined
          : createRepositoryChangeRunner(options.createModel(), {
              // Spread rather than assigned, because `exactOptionalPropertyTypes` tells "this option is
              // absent" apart from "this option is present and undefined", and only the first of those
              // means what is intended here.
              ...(describeCi === undefined ? {} : { readCi: describeCi }),
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
                // The number the record carries when the run pushed, read from the observation the
                // composition loaded rather than from anything the run said about itself. Absent on a
                // deployment that watches no CI: the record then says nobody could be asked.
                ...(readCiRun === undefined ? {} : { readCi: readCiRun }),
                // Written *by the run*, at the two moments it has facts for, rather than by this handler
                // once the run has returned. The mandate has to be on disk before anything can move, and a
                // run that dies in the middle is exactly the case that ordering exists for.
                record: (draft) => recordOne(chronicle, draft),
              });

              return {
                // Only a change that happened is success. "Nothing changed" and "we cannot tell" are both
                // answers to the person, and both leave the world as it was — but neither is the thing that
                // was asked for, so the exit code says so.
                outcome: execution.result.outcome === 'changed' ? 'ok' : 'failed',
                lines:
                  execution.recordError === undefined
                    ? execution.result.lines
                    : [...execution.result.lines, execution.recordError],
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
 * Writes one fact, and reports a failure as a line rather than as an exception.
 *
 * Called twice per run, from two different moments, and the moments are the point: the mandate goes in
 * before the run starts and the result after it ends. A record that refuses a write does not undo the
 * change — if the executor moved the world and the pen broke, the honest thing to say is that the change
 * happened and the record of it did not — which is why the sentence travels back to the human instead of
 * being swallowed here.
 */
async function recordOne(
  chronicle: { append(draft: FactDraft): Promise<DurableFact> },
  fact: FactDraft,
): Promise<string | undefined> {
  try {
    await chronicle.append(fact);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error && error.message !== '' ? error.message : String(error);
    return `这条记录没能写进事实史（${fact.type}）：${detail}`;
  }
}
