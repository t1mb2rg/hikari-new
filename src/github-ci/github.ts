import type { GitHubCiAcquirer, GitHubCiAcquisition } from './acquisition.js';
import { GitHubCiObservationError } from './errors.js';
import type { GitHubCiConclusion, GitHubCiLatestRun, GitHubCiRun } from './types.js';

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const ACQUISITION_TIMEOUT_MS = 10_000;

// One run is all this asks for, and asking for one is what makes the answer "the most recent run"
// rather than "a page of runs this module then has to order". The ordering stays GitHub's.
const LATEST_RUN_QUERY = '?per_page=1';

export interface GitHubCiAcquirerOptions {
  readonly owner: string;
  readonly name: string;
  // Seams for the tests, not configuration. The plugin never passes either: which API is spoken to
  // is not a decision a composer gets to make, and there is exactly one GitHub.
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

// Unauthenticated, read-only, over the built-in fetch. The `gh` CLI was considered and rejected:
// it authenticates from an ambient keyring this module cannot see, which would make the auth
// boundary something that depends on the machine rather than on the code, and it reports failures
// as process exit codes that would then need a taxonomy invented here. A plain HTTPS GET has one
// boundary — no credentials of any kind are sent, and the request either gets an answer or does not.
//
// The cost of that choice is stated rather than hidden: an unauthenticated caller shares a quota of
// 60 requests per hour per address, and one observation spends two. A caller that needs more is a
// caller that needs a credential, and a credential is a decision this slice does not make.
export function createGitHubCiAcquirer(options: GitHubCiAcquirerOptions): GitHubCiAcquirer {
  const baseUrl = (options.baseUrl ?? API_BASE).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? ACQUISITION_TIMEOUT_MS;
  const { owner, name } = options;

  const abort = new AbortController();
  let disposed = false;

  async function getJson(path: string): Promise<unknown> {
    if (disposed) {
      throw new GitHubCiObservationError('the acquirer was disposed');
    }

    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { accept: 'application/vnd.github+json', 'x-github-api-version': API_VERSION },
        signal,
      });
    } catch (error) {
      throw new GitHubCiObservationError(describeFailure(error, timeoutMs, abort.signal.aborted));
    }

    if (!response.ok) {
      throw new GitHubCiObservationError(await describeRejection(response, path));
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new GitHubCiObservationError(
        `GET ${path} answered HTTP ${response.status} with a body that is not JSON`,
      );
    }
  }

  return {
    async acquire(): Promise<GitHubCiAcquisition> {
      if (disposed) {
        throw new GitHubCiObservationError('the acquirer was disposed');
      }

      const observedAt = new Date().toISOString();

      // Two requests, and the first one is not ceremony. GitHub resolves owner and name
      // case-insensitively and answers with its own spelling, so the name it is asked about and the
      // name it reports are two facts, and only the second one is the repository's actual name.
      // What is configured is a way of referring to a repository; what comes back is what that
      // reference turned out to point at.
      const repository = await readCanonicalName(getJson, owner, name);
      const latestRun = await readLatestRun(getJson, owner, name);

      return Object.freeze({ observedAt, repository, latestRun });
    },

    async dispose(): Promise<void> {
      disposed = true;
      abort.abort();
    },
  };
}

async function readCanonicalName(
  getJson: (path: string) => Promise<unknown>,
  owner: string,
  name: string,
): Promise<string> {
  const payload = await getJson(`/repos/${owner}/${name}`);
  return readString(asRecord(payload, 'repository'), 'full_name', 'repository');
}

async function readLatestRun(
  getJson: (path: string) => Promise<unknown>,
  owner: string,
  name: string,
): Promise<GitHubCiLatestRun> {
  const payload = await getJson(`/repos/${owner}/${name}/actions/runs${LATEST_RUN_QUERY}`);
  const runs = asRecord(payload, 'runs').workflow_runs;

  if (!Array.isArray(runs)) {
    throw new GitHubCiObservationError('the runs answer carried no workflow_runs list');
  }

  // No runs is a state of the repository rather than a gap in the answer: a repository whose
  // workflows have never run has a CI history, and it is empty.
  if (runs.length === 0) {
    return Object.freeze({ kind: 'none' as const });
  }

  return Object.freeze({ kind: 'reported' as const, run: readRun(asRecord(runs[0], 'run')) });
}

function readRun(run: Record<string, unknown>): GitHubCiRun {
  const id = run.id;
  if (typeof id !== 'number' || !Number.isInteger(id)) {
    throw new GitHubCiObservationError('a run was reported without a usable id');
  }

  return Object.freeze({
    id,
    workflow: readString(run, 'name', 'run'),
    headBranch: readString(run, 'head_branch', 'run'),
    headSha: readString(run, 'head_sha', 'run'),
    status: readString(run, 'status', 'run'),
    conclusion: readConclusion(run),
  });
}

// `null` is what GitHub sends for a run that has not concluded, and it sends it instead of the
// field's absence and instead of an empty string. Reported as its own state rather than folded into
// the run's absence, because "this run has not concluded" and "there is no run" are different
// facts about the repository. With `per_page=1` this is the common case and not an edge one: the
// most recent run is frequently still going.
//
// The line between a state and a failure is drawn there for the whole module: what GitHub
// legitimately says and this module cannot improve on becomes a state, and what it should not say
// becomes a failed observation rather than a hole. `conclusion` is null on every unfinished run, so
// it is a state. `head_branch` and `head_sha` are not — a run missing one is not a run this module
// understood, and passing the hole along would hand a caller a run it cannot trust.
function readConclusion(run: Record<string, unknown>): GitHubCiConclusion {
  const value = run.conclusion;
  if (value === null || value === undefined) {
    return Object.freeze({ kind: 'absent' as const });
  }

  if (typeof value !== 'string' || !value) {
    throw new GitHubCiObservationError('a run was reported with a conclusion that is not a string');
  }

  return Object.freeze({ kind: 'reported' as const, value });
}

// A 404 here does not mean the repository does not exist, and a reader of the failure needs to know
// that: to an unauthenticated caller GitHub answers 404 for a private repository exactly as it does
// for a nonexistent one, because telling the two apart is itself information it withholds. This
// module reports the status and GitHub's own words and stops there, which leaves the ambiguity
// where it belongs — with the credentials this slice does not have.
async function describeRejection(response: Response, path: string): Promise<string> {
  const parts = [`GET ${path} answered HTTP ${response.status}`];

  const message = await readErrorMessage(response);
  if (message !== null) {
    parts.push(`GitHub said: ${message}`);
  }

  const quota = describeQuota(response.headers);
  if (quota !== null) {
    parts.push(quota);
  }

  return parts.join('; ');
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const { message } = body as { message?: unknown };
      if (typeof message === 'string' && message) {
        return message;
      }
    }
  } catch {
    // A body that is not JSON carries no message to quote, and that is not itself a failure worth
    // reporting: the status already said what happened.
  }

  return null;
}

// Quota is transport, not repository state, so it never becomes part of an observation. It is worth
// saying out loud only when it is the reason a request was refused, which is exactly here.
function describeQuota(headers: Headers): string | null {
  if (headers.get('x-ratelimit-remaining') !== '0') {
    return null;
  }

  const reset = Number(headers.get('x-ratelimit-reset'));
  if (!Number.isFinite(reset)) {
    return 'the unauthenticated request quota is exhausted';
  }

  const at = new Date(reset * 1000);
  if (Number.isNaN(at.getTime())) {
    return 'the unauthenticated request quota is exhausted';
  }

  return `the unauthenticated request quota is exhausted until ${at.toISOString()}`;
}

function describeFailure(error: unknown, timeoutMs: number, disposed: boolean): string {
  if (disposed) {
    return 'the acquirer was disposed while an observation was in flight';
  }

  if (error instanceof Error && error.name === 'TimeoutError') {
    return `no answer within ${timeoutMs} ms`;
  }

  if (error instanceof Error) {
    const code = readFailureCode((error as { cause?: unknown }).cause);
    return code === null ? error.message : `${error.message} (${code})`;
  }

  return String(error);
}

// A refused connection arrives as `fetch failed` wrapping the real reason, and that reason is where
// the only useful word is. No table of codes: the code is passed through as GitHub's neighbours are,
// and a caller that wants to distinguish them can read it.
function readFailureCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) {
    return null;
  }

  const { code } = cause as { code?: unknown };
  if (typeof code === 'string') {
    return code;
  }

  // An AggregateError from a host that resolved to several addresses, none of which answered.
  const { errors } = cause as { errors?: unknown };
  if (Array.isArray(errors)) {
    for (const inner of errors) {
      const innerCode = readFailureCode(inner);
      if (innerCode !== null) {
        return innerCode;
      }
    }
  }

  return null;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GitHubCiObservationError(`the ${what} answer was not an object`);
  }

  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, what: string): string {
  const value = record[key];
  if (typeof value !== 'string' || !value) {
    throw new GitHubCiObservationError(`a ${what} was reported without a usable ${key}`);
  }

  return value;
}
