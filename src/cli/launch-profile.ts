// The Resident's launch profile — a data directory remembering how it was asked to start.
//
// What this file owns: where the profile lives, the shape it may take, and the two directions of
// turning that shape into text and back. What it does not own: whether a configuration is legal.
// That question has exactly one answer in this build and it is `options.ts` — a profile is written by
// running the resident's own reader over an argument list, so a profile that exists is one that
// reader accepted, and this file never decides for itself that some combination is acceptable.
//
// It is not read by the resident. Nothing in `resident.ts` or the composition knows this file exists:
// the profile's only reader is the console, which turns it back into an explicit `hikari resident`
// command line and runs that. So the profile is not a second way to configure a resident — it is a
// remembered way to spell the first one.
//
// The profile lives *inside* the data directory rather than anywhere user-wide, and that is the whole
// of the boundary this slice was allowed to move. A data directory is a Hikari's identity, its store
// and its control endpoint; a search path, a home-directory profile or a "last used" list would each
// be a user config location, which is a different subject than the one a real consumer asked for.

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ModelOptions, RepositoryCiOptions, ResidentOptions } from './options.js';

/** A resident's configuration as it is remembered: everything `resident` takes except the directory. */
export type LaunchProfile = Omit<ResidentOptions, 'dataDir'>;

export function launchProfilePath(dataDir: string): string {
  return join(dataDir, 'launch.json');
}

/**
 * The profile as this build writes it, or a sentence saying why it could not be read.
 *
 * Absent and unreadable are deliberately one answer rather than two. A caller that could tell them
 * apart would be a caller deciding what to do about a corrupt profile — recreate it, refuse to start
 * a resident, warn and continue — and every one of those is a decision about the operator's
 * configuration that only the operator can make. What the caller can act on is the sentence.
 */
export type ReadProfileResult =
  | { readonly kind: 'profile'; readonly profile: LaunchProfile }
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly reason: string };

export function readLaunchProfile(dataDir: string): ReadProfileResult {
  let text: string;
  try {
    text = readFileSync(launchProfilePath(dataDir), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return { kind: 'none' };
    return { kind: 'unreadable', reason: describeError(error) };
  }

  return decodeLaunchProfile(text);
}

export function writeLaunchProfile(dataDir: string, profile: LaunchProfile): void {
  writeFileSync(launchProfilePath(dataDir), encodeLaunchProfile(profile), 'utf8');
}

/** Idempotent. Clearing a profile that was never written is the ordinary case, not an error. */
export function clearLaunchProfile(dataDir: string): void {
  try {
    rmSync(launchProfilePath(dataDir));
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
}

/**
 * The profile as JSON text: exactly the keys that have a value, and no key whose flag was absent.
 *
 * The omission is load-bearing rather than tidiness. Two members of `ModelOptions` are `undefined` for
 * reasons of their own — `credentialEnv` absent means "send no credential", `reasoningEffort` absent
 * means "this request has no such field" — and a JSON null would collapse "absent" into a value the
 * resident's reader would then have to interpret. Writing nothing is the only spelling of absent that
 * cannot be misread.
 */
export function encodeLaunchProfile(profile: LaunchProfile): string {
  const encoded: Record<string, unknown> = {
    desktopAwarenessDelayMs: profile.desktopAwarenessDelayMs,
  };

  if (profile.repositoryCi !== undefined) encoded.repositoryCi = encodeRepositoryCi(profile.repositoryCi);
  if (profile.model !== undefined) encoded.model = encodeModel(profile.model);
  if (profile.proactiveCiDelayMs !== undefined) encoded.proactiveCiDelayMs = profile.proactiveCiDelayMs;
  if (profile.proactiveReturn !== undefined) {
    encoded.proactiveReturn = {
      delayMs: profile.proactiveReturn.delayMs,
      afterMs: profile.proactiveReturn.afterMs,
    };
  }

  return `${JSON.stringify(encoded, undefined, 2)}\n`;
}

// Strict about keys, in both directions, for the reason the control protocol is: a decoder that
// shrugged at unknown fields would already be an extensible schema, and every later change to this
// shape would then have to be a change that keeps old files readable. Refusing them means an old file
// says so rather than being half-understood — and it is why nothing here carries a version number.
export function decodeLaunchProfile(text: string): ReadProfileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripByteOrderMark(text));
  } catch {
    return { kind: 'unreadable', reason: '启动配置不是合法的 JSON。' };
  }

  const root = readObject(parsed, ['desktopAwarenessDelayMs', 'repositoryCi', 'model', 'proactiveCiDelayMs', 'proactiveReturn'], [
    'desktopAwarenessDelayMs',
  ]);
  if (typeof root === 'string') return { kind: 'unreadable', reason: root };

  const delay = root.desktopAwarenessDelayMs;
  if (typeof delay !== 'number' || !Number.isFinite(delay)) {
    return { kind: 'unreadable', reason: 'desktopAwarenessDelayMs 不是一个数。' };
  }

  const repositoryCi = decodeRepositoryCi(root.repositoryCi);
  if (typeof repositoryCi === 'string') return { kind: 'unreadable', reason: repositoryCi };

  const model = decodeModel(root.model);
  if (typeof model === 'string') return { kind: 'unreadable', reason: model };

  const proactiveCiDelayMs = root.proactiveCiDelayMs;
  if (proactiveCiDelayMs !== undefined && (typeof proactiveCiDelayMs !== 'number' || !Number.isFinite(proactiveCiDelayMs))) {
    return { kind: 'unreadable', reason: 'proactiveCiDelayMs 不是一个数。' };
  }

  const proactiveReturn = decodeProactiveReturn(root.proactiveReturn);
  if (typeof proactiveReturn === 'string') return { kind: 'unreadable', reason: proactiveReturn };

  const profile: LaunchProfile = {
    desktopAwarenessDelayMs: delay,
    ...(repositoryCi === undefined ? {} : { repositoryCi }),
    ...(model === undefined ? {} : { model }),
    ...(proactiveCiDelayMs === undefined ? {} : { proactiveCiDelayMs }),
    ...(proactiveReturn === undefined ? {} : { proactiveReturn }),
  };
  return { kind: 'profile', profile };
}

/**
 * The profile as the `hikari resident` arguments that reproduce it.
 *
 * This is the invariant the whole slice rests on, written as a function: whatever the console starts,
 * it starts by handing this array to a new `hikari resident` process, so every launch it can perform
 * is one an operator could have typed. Nothing is defaulted here and no value is repaired — a member
 * the profile does not have contributes no flag, exactly as it would have been absent from the command
 * line that wrote the profile.
 *
 * The round trip is not merely conventional. `profile set` builds the profile by running the
 * resident's own reader over an argument list, and the resident re-runs that same reader over the
 * array below, so a profile this build wrote cannot name a configuration the resident refuses.
 */
export function launchArguments(dataDir: string, profile: LaunchProfile): readonly string[] {
  const args: string[] = [
    'resident',
    '--data-dir',
    dataDir,
    '--desktop-awareness-delay-ms',
    String(profile.desktopAwarenessDelayMs),
  ];

  const { repositoryCi, model } = profile;
  if (repositoryCi !== undefined) {
    args.push('--repository-root', repositoryCi.rootDir, '--repository', repositoryCi.repository);
  }
  if (model !== undefined) {
    args.push('--model-endpoint', model.endpoint, '--model', model.model);
    if (model.credentialEnv !== undefined) args.push('--model-credential-env', model.credentialEnv);
    if (model.reasoningEffort !== undefined) args.push('--model-reasoning-effort', model.reasoningEffort);
  }
  if (profile.proactiveCiDelayMs !== undefined) {
    args.push('--proactive-ci-delay-ms', String(profile.proactiveCiDelayMs));
  }
  if (profile.proactiveReturn !== undefined) {
    args.push(
      '--proactive-return-delay-ms',
      String(profile.proactiveReturn.delayMs),
      '--proactive-return-after-ms',
      String(profile.proactiveReturn.afterMs),
    );
  }

  return args;
}

/**
 * The same arguments as one line a human can read and copy.
 *
 * Quoted only where a shell would otherwise split the token, and the quoting is a display convention:
 * the array above is what runs. A token containing a quote is shown as it is rather than escaped into
 * a form this file cannot promise any particular shell will read back — a line that claims to be
 * pasteable and is not would be worse than one that plainly is not.
 */
export function renderLaunchArguments(args: readonly string[]): string {
  return `hikari ${args.map(quoteForDisplay).join(' ')}`;
}

function quoteForDisplay(token: string): string {
  return /[\s"]/.test(token) ? `"${token}"` : token;
}

function encodeRepositoryCi(repositoryCi: RepositoryCiOptions): Record<string, unknown> {
  return { rootDir: repositoryCi.rootDir, repository: repositoryCi.repository };
}

function encodeModel(model: ModelOptions): Record<string, unknown> {
  const encoded: Record<string, unknown> = { endpoint: model.endpoint, model: model.model };
  if (model.credentialEnv !== undefined) encoded.credentialEnv = model.credentialEnv;
  if (model.reasoningEffort !== undefined) encoded.reasoningEffort = model.reasoningEffort;
  return encoded;
}

// `undefined` in, `undefined` out — the file not having the key and the caller asking about a key the
// file never had are the same case. A string return is the reason it could not be read.
function decodeRepositoryCi(value: unknown): RepositoryCiOptions | undefined | string {
  if (value === undefined) return undefined;

  const record = readObject(value, ['rootDir', 'repository'], ['rootDir', 'repository']);
  if (typeof record === 'string') return record;

  const { rootDir, repository } = record;
  if (typeof rootDir !== 'string' || typeof repository !== 'string') {
    return 'repositoryCi 的 rootDir 与 repository 都必须是字符串。';
  }
  return Object.freeze({ rootDir, repository });
}

function decodeModel(value: unknown): ModelOptions | undefined | string {
  if (value === undefined) return undefined;

  const record = readObject(value, ['endpoint', 'model', 'credentialEnv', 'reasoningEffort'], ['endpoint', 'model']);
  if (typeof record === 'string') return record;

  const { endpoint, model, credentialEnv, reasoningEffort } = record;
  if (typeof endpoint !== 'string' || typeof model !== 'string') {
    return 'model 的 endpoint 与 model 都必须是字符串。';
  }
  if (credentialEnv !== undefined && typeof credentialEnv !== 'string') {
    return 'model 的 credentialEnv 必须是字符串。';
  }
  if (reasoningEffort !== undefined && typeof reasoningEffort !== 'string') {
    return 'model 的 reasoningEffort 必须是字符串。';
  }
  return Object.freeze({ endpoint, model, credentialEnv, reasoningEffort });
}

function decodeProactiveReturn(value: unknown): { delayMs: number; afterMs: number } | undefined | string {
  if (value === undefined) return undefined;

  const record = readObject(value, ['delayMs', 'afterMs'], ['delayMs', 'afterMs']);
  if (typeof record === 'string') return record;

  const { delayMs, afterMs } = record;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs)) return 'proactiveReturn 的 delayMs 不是一个数。';
  if (typeof afterMs !== 'number' || !Number.isFinite(afterMs)) return 'proactiveReturn 的 afterMs 不是一个数。';
  return Object.freeze({ delayMs, afterMs });
}

// Exactly these keys and no others, and every required key present. Returns the record, or a sentence.
function readObject(
  value: unknown,
  permitted: readonly string[],
  required: readonly string[],
): Record<string, unknown> | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '启动配置的某一层不是对象。';

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!permitted.includes(key)) return `启动配置里有未知的键：${key}。`;
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) return `启动配置里缺少必需的键：${key}。`;
  }
  return record;
}

// A byte-order mark is an encoding artifact, not shape, and it is dropped before parsing rather than
// being refused as one. `JSON.parse` rejects a leading U+FEFF outright, and this is the one platform
// this build's control endpoint supports — where the tools an operator reaches for to write a file by
// hand (Windows PowerShell's `Set-Content -Encoding utf8` among them) write one by default. Without
// this, a hand-edited profile that is perfectly legal JSON is reported as "not legal JSON", which is a
// reason its author can do nothing with because it is not the reason.
//
// Nothing else is normalised. Trailing commas, comments, unquoted keys and every other JSON-adjacent
// convenience stay refused: those change what the text means, and a reader that accepted them would be
// defining a second dialect whose rules no writer here agreed to.
function stripByteOrderMark(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
