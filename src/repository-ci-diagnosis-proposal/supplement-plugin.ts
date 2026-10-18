// The supplement, as a plugin.
//
// It exists so that one file can be reached from inside a composition without any other module having
// to construct it, and so that the composition — not the module — decides whether a model is configured
// at all. Both are the same discipline the rest of this repository uses: a capability being loadable is
// not a capability being used, and a module does not read its own configuration out of the environment.
//
// What it owns: whether there is a supplement for one failure, and what it says. What it does not own:
// what CI is (`github-ci`), whether a suggestion exists (`repository-ci-diagnosis-proposal`), when the
// message is sent or whether it is sent at all (`repository-ci-attention`), who receives it
// (`human-delivery`), or how the rest of the message is worded (`language`).
//
// It requires the materials reader and nothing else. Not the diagnosis module: the judgement it is
// added to arrives as an argument, because the caller already has it and asking again would be asking
// the same question twice in one cycle, with two chances to answer differently.
//
// No model configured is the normal state of this build. `--model-endpoint` for the supplement is not
// wired in this slice — the operator's token and budget flags land together in the next one — so a
// resident today loads this plugin and it answers `undefined` to everything. That is not a stub: it is
// the fail-closed default, and the tests hold it there by composing the plugin with no model and
// asserting the message is byte-identical to what the build produced before this slice.

import { gitHubCiRunMaterialsService } from '../github-ci/contracts.js';
import type { PluginDefinition } from '../runtime/plugin.js';

import { repositoryCiDiagnosisSupplementService } from './contracts.js';
import {
  createRepositoryCiDiagnosisSupplement,
  type RepositoryCiDiagnosisSupplementModel,
} from './supplement.js';

export interface RepositoryCiDiagnosisSupplementPluginConfig {
  /**
   * Absent means no model, which means no supplement, which is the whole of the opt-in.
   *
   * All three fields together and none of them defaulted: a budget that came from a default would be
   * this module deciding how long a human waits for a model, which is the operator's decision to make
   * or to not make.
   */
  readonly model?: RepositoryCiDiagnosisSupplementModel | undefined;
  /**
   * Where a failure worth reporting goes. Handed in by the runner, because the runner owns stderr and a
   * plugin that wrote to it directly would be a plugin whose output lands somewhere it did not choose.
   * Absent is silence, which is the right default for a test and an honest one for a composition that
   * has nowhere to put the line.
   */
  readonly log?: ((line: string) => void) | undefined;
}

const MIN_BUDGET_MS = 30_000;
const MAX_BUDGET_MS = 600_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseModel(input: unknown): RepositoryCiDiagnosisSupplementModel {
  if (!isObject(input)) {
    throw new Error('repository-ci-diagnosis-supplement requires model to be an object.');
  }

  const { endpoint, model, budgetMs } = input;

  if (typeof endpoint !== 'string' || endpoint.trim() === '') {
    throw new Error(
      'repository-ci-diagnosis-supplement requires a non-empty model.endpoint (an OpenAI-compatible chat completions URL).',
    );
  }

  if (!/^https?:\/\//.test(endpoint)) {
    throw new Error(
      `repository-ci-diagnosis-supplement requires model.endpoint to be an http(s) URL, received ${JSON.stringify(endpoint)}.`,
    );
  }

  if (typeof model !== 'string' || model.trim() === '') {
    throw new Error('repository-ci-diagnosis-supplement requires a non-empty model.model.');
  }

  if (
    typeof budgetMs !== 'number' ||
    !Number.isInteger(budgetMs) ||
    budgetMs < MIN_BUDGET_MS ||
    budgetMs > MAX_BUDGET_MS
  ) {
    throw new Error(
      `repository-ci-diagnosis-supplement requires an integer model.budgetMs between ${MIN_BUDGET_MS} and ${MAX_BUDGET_MS}, received ${String(budgetMs)}.`,
    );
  }

  return Object.freeze({ endpoint: endpoint.trim(), model: model.trim(), budgetMs });
}

function parseConfig(input: unknown): RepositoryCiDiagnosisSupplementPluginConfig {
  if (input === undefined || input === null) return Object.freeze({});
  if (!isObject(input)) {
    throw new Error('repository-ci-diagnosis-supplement config must be an object when present.');
  }

  const { model, log } = input;

  if (log !== undefined && typeof log !== 'function') {
    throw new Error('repository-ci-diagnosis-supplement config.log must be a function when present.');
  }

  return Object.freeze({
    model: model === undefined ? undefined : parseModel(model),
    log: log as ((line: string) => void) | undefined,
  });
}

export const repositoryCiDiagnosisSupplementPlugin: PluginDefinition<RepositoryCiDiagnosisSupplementPluginConfig> =
  {
    id: 'repository-ci-diagnosis-supplement',
    version: '1.0.0',
    // One requirement: the materials reader. Everything else this module needs it is handed.
    requires: [gitHubCiRunMaterialsService],
    provides: [repositoryCiDiagnosisSupplementService],
    config: { parse: parseConfig },
    setup(context, config) {
      const materials = context.services.get(gitHubCiRunMaterialsService);

      const supplement = createRepositoryCiDiagnosisSupplement({
        readMaterials: (query) => materials.getRunMaterials(query),
        model: config.model,
        log: config.log,
      });

      async function attach(
        request: Parameters<typeof supplement.attach>[0],
      ): ReturnType<typeof supplement.attach> {
        return supplement.attach(request);
      }

      context.services.provide(repositoryCiDiagnosisSupplementService, Object.freeze({ attach }));
    },
  };
