// The transport, as the composition loads it.
//
// It requires nothing and provides one thing, and that combination is the whole of the ruling it
// implements. A plugin with no requirements is `active` the moment it is loaded — the Runtime
// reconciles requirements, not demand, so "nobody is connected" cannot reach this state at all. A
// transport whose activation depended on a client would make a human's evening into a composition
// failure, and `authorized ≠ connected` is exactly the distinction that forbids it.
//
// So there are two facts here that look like one and are not, and they are answered in two different
// places. Whether a client is connected is a runtime fact about a socket, and it is answered by
// `deliver` returning `unavailable` — an outcome, not a state change. Whether the host can carry this
// at all is a fact about the platform, it is fixed for the life of the process, and it is answered
// here at activation by refusing to start. That second one is the same refusal every Windows-bound
// plugin in this repository makes, and it is not a readiness decision a client can influence: an
// operator who configured proactive delivery on a host with no pipe namespace has a misconfiguration,
// and a resident that came up anyway would be one that silently never told them anything.

import type { PluginDefinition } from '../runtime/plugin.js';

import { humanDeliveryService } from './contracts.js';
import { listenDeliveryEndpoint } from './endpoint.js';
import { humanDeliveryEndpointPath } from './endpoint-path.js';
import { HumanDeliveryError } from './errors.js';

export interface HumanDeliveryPluginConfig {
  readonly rootDir: string;
}

// The data directory, and only what is needed to derive this plugin's own endpoint from it. Declared
// rather than imported from `cli/options.ts`, for the reason `endpoint-path.ts` gives: a domain plugin
// that named a command's option type would have taken a dependency on a command.
function parseConfig(input: unknown): HumanDeliveryPluginConfig {
  const candidate =
    typeof input === 'object' && input !== null
      ? (input as { readonly rootDir?: unknown }).rootDir
      : undefined;

  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error(`human-delivery requires a non-empty rootDir, received ${String(candidate)}.`);
  }

  return Object.freeze({ rootDir: candidate });
}

export const humanDeliveryPlugin: PluginDefinition<HumanDeliveryPluginConfig> = {
  id: 'human-delivery',
  version: '1.0.0',
  // Nothing. This plugin is the end of the path: it reads no capability and no fact, and a requirement
  // here would be a claim that delivery needs to know something before it can carry it.
  requires: [],
  provides: [humanDeliveryService],
  config: { parse: parseConfig },
  async setup(context, config) {
    const path = humanDeliveryEndpointPath(config.rootDir);
    if (path === undefined) {
      throw new HumanDeliveryError('人类投递入口依赖 Windows 命名管道，本机没有。');
    }

    const endpoint = await listenDeliveryEndpoint(path);

    // Registered after the listener exists and before the Service is offered, so that a teardown which
    // starts during activation still finds something to close. LIFO ordering disposes this before the
    // plugins that depend on it, which is what lets a decider's in-flight cycle finish against a
    // transport that is still there.
    context.defer(() => endpoint.close());

    context.services.provide(humanDeliveryService, {
      // A delegation rather than a second implementation, and it is deliberately the whole method
      // body: everything that could be decided about a delivery — whether anyone is connected, whether
      // the write failed — is decided in `endpoint.ts`, and a copy of that reasoning here would be a
      // second answer to a question that already has one.
      deliver: (lines) => endpoint.write(lines),
    });
  },
};
