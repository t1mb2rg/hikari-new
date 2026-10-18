// What GitHub reports about one run that has already been observed.
//
// The observation (`github-ci.current`) answers "what is this repository doing now". This answers a
// narrower and older question: "what did *that* run leave behind", where *that* run is one a caller
// already saw and named. The two are separate reads on purpose. An observation is a fresh fact about
// the repository; a material is a fixed fact about one run. Reading materials through the observation
// would let a slow or failing material request change what the repository looks like, and it would
// also make every caller of `current()` pay for a read it did not ask for.
//
// Three rules, and the shape of the result follows from them:
//
// 1. Each material is independent. A log that could not be read says nothing about the diff; one
//    `missing` never spreads to the other fields.
// 2. Truncation is an attribute of "present", not a kind of absence. What was not sent is recorded
//    next to what was, so a reader can tell "there was nothing there" from "we did not look at all of
//    it" — the difference between an empty answer and a cut one.
// 3. Nothing here decides whether a material is *enough*. That is the consuming side's eligibility
//    rule. This module does not know what a diagnosis is, and the day it starts guessing is the day
//    the collector begins ruling on subjects it was not given.
//
// Nothing in this file throws for a request that failed. A failed read is a value — `missing` with a
// reason — because the callers that matter here must be able to keep going with less: the notification
// about a failed run is not allowed to depend on whether we could also fetch its log.

const API_BASE = 'https://api.github.com';
const API_VERSION = '2022-11-28';

// One request's ceiling, matching the observation's own (`src/github-ci/github.ts:7`); the three
// requests share a separate total ceiling below, which is the one that matters to a caller.
const REQUEST_TIMEOUT_MS = 10_000;

// Three sequential requests. A caller with a model on the far side budgets seconds, not minutes, and
// a material read that overruns is not half-useful: what arrives after the caller gave up is worthless.
const MATERIALS_TIMEOUT_MS = 20_000;

// The jobs answer carries names, conclusions and step lists. Anything past a megabyte is not that
// answer, and reading it would only to reject it later.
const JOBS_BODY_LIMIT_BYTES = 1024 * 1024;

// The log is unbounded on GitHub's side (a real failed run produced 140 KiB), so it is read as a
// stream: keep a rolling window of the tail, stop scanning after the hard limit, and abort. The window
// is what is left after the failing step has been located — not simply the last bytes, because the
// bytes at the end of a GitHub log are cleanup chatter rather than the failure.
const LOG_WINDOW_BYTES = 64 * 1024;
const LOG_SCAN_LIMIT_BYTES = 512 * 1024;

// Diff caps, per §10.8. A patch is for a person — and for a model — to see what changed, not a full
// diff archive; both would rather have twenty files than two hundred lines of a lockfile.
const MAX_PATCH_FILES = 20;
const MAX_PATCH_LINES_PER_FILE = 200;
const MAX_PATCH_LINES_TOTAL = 400;

// Everything that can make one material absent. The reasons are the answer to "why is this not
// here", and they are deliberately different from each other: a caller deciding what to do next needs
// to tell a repository it cannot see from a quota it has used up from a body it could not parse.
export type GitHubCiMaterialGap =
  // 404. GitHub answers it for a private repository exactly as for a nonexistent one, so this reason
  // names the code rather than a conclusion about the repository.
  | 'not-found'
  // 401, or 403 without a rate-limit signal: the credential is missing, wrong, or not allowed to read
  // this — the log endpoint answers "Must have admin rights to Repository." this way.
  | 'authentication'
  // 403 with the quota at zero, or 429. Waits do not help within a cycle; the next cycle is the retry.
  | 'rate-limited'
  // The request never produced an answer: DNS, TLS, refused connection, or a server that answered 5xx.
  | 'transport'
  // No answer inside the budget this request was given.
  | 'timeout'
  // An answer that arrived and was not usable: not JSON, not the shape this module reads, a body past
  // the size limit, or an unexpected redirect.
  | 'unusable-answer';

export type GitHubCiMaterial<T> =
  | { readonly kind: 'present'; readonly value: T }
  // Only meaningful for `jobs`: the run has been observed but GitHub has not created its jobs yet.
  | { readonly kind: 'pending' }
  | { readonly kind: 'missing'; readonly reason: GitHubCiMaterialGap };

export interface GitHubCiMaterialStep {
  readonly name: string;
  // GitHub's own word, or null while the step has not finished. Passed through rather than mapped
  // onto a set closed here, for the reason `types.ts` gives about run status.
  readonly conclusion: string | null;
}

export interface GitHubCiJobMaterial {
  readonly id: number;
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly steps: readonly GitHubCiMaterialStep[];
  // Every job GitHub reports carries the identity of the run it belongs to. That is what makes "is
  // this the run I asked about" a property of the answer itself instead of a fourth request — and a
  // fourth request would be a request that can disagree.
  readonly runId: number;
  readonly headSha: string;
}

export type GitHubCiFilePatch =
  // `cut` says the text was shortened by this module's caps; the file was not sent whole.
  | { readonly kind: 'present'; readonly text: string; readonly cut: boolean }
  // The answer carries no patch text for this file. GitHub omits it for binary files and for diffs too
  // large to inline, and this module cannot tell those two apart from the answer — so the reason names
  // what is known (no text) rather than guessing at why.
  | { readonly kind: 'absent'; readonly why: 'binary' | 'over-limit' };

export interface GitHubCiChangedFile {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: GitHubCiFilePatch;
}

export interface GitHubCiChangedFiles {
  readonly files: readonly GitHubCiChangedFile[];
  // What GitHub listed, including files this module dropped for the cap: an answer that listed sixty
  // files and sent twenty says so, rather than looking like a four-file change.
  readonly totalFiles: number;
  readonly omittedFiles: number;
}

export interface GitHubCiLogExcerpt {
  // ANSI escape sequences removed. A real log carries colour codes; they are transport decoration, not
  // content, and a model reading `\x1b[31m` spends tokens on nothing.
  readonly text: string;
  // Which slice of the log this is. `failing-step` means the excerpt starts at the step that failed;
  // `tail` means no step marker was found and the window is the end of what was read.
  readonly window: 'failing-step' | 'tail';
  // The step the excerpt was anchored to, when one could be located from the jobs answer.
  readonly step: string | null;
  readonly bytesRead: number;
  // Bytes read but not in `text` — dropped at the front because the window moved, or left unread
  // because the scan limit was reached.
  readonly droppedBytes: number;
  readonly truncated: boolean;
  // What the response declared, when it declared anything. `null` is "the answer did not say".
  readonly totalBytes: number | null;
  readonly ansiStripped: boolean;
}

export interface GitHubCiRunMaterials {
  readonly requestedAt: string;
  // The reference this reader is bound to (`owner/name` as configured), not a name re-derived from an
  // answer: the canonical spelling is the observation's fact, and materials are bound to a run by
  // `runId` + `headSha` rather than by a repository name.
  readonly repository: string;
  readonly runId: number;
  readonly headSha: string;
  // Whether the answer this module read identifies itself as the run that was asked about. `mismatch`
  // means the mats came back for something else, OR that nothing came back to confirm the identity —
  // a caller must not read "we could not check" as "we checked".
  readonly identity: 'confirmed' | 'mismatch';
  readonly jobs: GitHubCiMaterial<readonly GitHubCiJobMaterial[]>;
  readonly changedFiles: GitHubCiMaterial<GitHubCiChangedFiles>;
  readonly log: GitHubCiMaterial<GitHubCiLogExcerpt>;
}

// What is asked of this reader. `repository` is carried so that a caller cannot silently borrow the
// reader's configuration: the read is bound to a named repository and a named run, and both travel.
export interface GitHubCiRunMaterialsQuery {
  readonly repository: string;
  readonly runId: number;
  readonly headSha: string;
}

export interface GitHubCiRunMaterialsReader {
  getRunMaterials(query: GitHubCiRunMaterialsQuery): Promise<GitHubCiRunMaterials>;
}

export interface GitHubCiRunMaterialsOptions {
  readonly owner: string;
  readonly name: string;
  // Seams for the tests. The plugin passes neither: there is one GitHub, and which API is spoken to is
  // not a composer's decision — the same rule the acquirer states in `github.ts`.
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly requestTimeoutMs?: number;
  // The credential the log endpoint needs. Absent means anonymous, and an anonymous log read is
  // `missing('authentication')` rather than a silent empty answer. This module never logs, stores or
  // returns it — it goes into one request header and nowhere else.
  readonly token?: string;
}

export function createGitHubCiRunMaterialsReader(
  options: GitHubCiRunMaterialsOptions,
): GitHubCiRunMaterialsReader {
  const baseUrl = (options.baseUrl ?? API_BASE).replace(/\/+$/, '');
  const totalMs = options.timeoutMs ?? MATERIALS_TIMEOUT_MS;
  const requestMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const reference = `${options.owner}/${options.name}`;
  const token = options.token;

  function headers(authenticate: boolean): Record<string, string> {
    const base: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': API_VERSION,
    };

    return authenticate && token !== undefined && token !== ''
      ? { ...base, authorization: `Bearer ${token}` }
      : base;
  }

  // Every read goes through this, and every failure leaves as a `GitHubCiMaterial`, never as a thrown
  // error: a caller that has to wrap each call in try/catch would eventually forget one, and the
  // failure would then travel as an unhandled rejection inside a cycle that is supposed to be silent.
  async function readJson(
    path: string,
    deadline: number,
  ): Promise<{ kind: 'ok'; value: unknown } | { kind: 'gap'; reason: GitHubCiMaterialGap }> {
    const budget = Math.min(requestMs, deadline - Date.now());
    if (budget <= 0) {
      return { kind: 'gap', reason: 'timeout' };
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: headers(true),
        signal: AbortSignal.timeout(budget),
      });
    } catch (error) {
      return { kind: 'gap', reason: transportReason(error) };
    }

    if (!response.ok) {
      return { kind: 'gap', reason: refusalReason(response) };
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      return { kind: 'gap', reason: transportReason(error) };
    }

    if (Buffer.byteLength(body, 'utf8') > JOBS_BODY_LIMIT_BYTES) {
      return { kind: 'gap', reason: 'unusable-answer' };
    }

    try {
      return { kind: 'ok', value: JSON.parse(body) as unknown };
    } catch {
      return { kind: 'gap', reason: 'unusable-answer' };
    }
  }

  async function readChangedFiles(
    headSha: string,
    deadline: number,
  ): Promise<GitHubCiMaterial<GitHubCiChangedFiles>> {
    const answer = await readJson(
      `/repos/${options.owner}/${options.name}/commits/${headSha}`,
      deadline,
    );
    if (answer.kind === 'gap') {
      return { kind: 'missing', reason: answer.reason };
    }

    const record = asRecord(answer.value);
    if (record === null) {
      return { kind: 'missing', reason: 'unusable-answer' };
    }

    const raw = record.files;
    if (!Array.isArray(raw)) {
      return { kind: 'missing', reason: 'unusable-answer' };
    }

    return { kind: 'present', value: limitFiles(raw) };
  }

  async function readJobList(
    query: GitHubCiRunMaterialsQuery,
    deadline: number,
  ): Promise<
    | { readonly kind: 'present'; readonly jobs: readonly GitHubCiJobMaterial[]; readonly pending: boolean }
    | { readonly kind: 'pending' }
    | { readonly kind: 'missing'; readonly reason: GitHubCiMaterialGap }
  > {
    const answer = await readJson(
      `/repos/${options.owner}/${options.name}/actions/runs/${query.runId}/jobs?per_page=100`,
      deadline,
    );
    if (answer.kind === 'gap') {
      return { kind: 'missing', reason: answer.reason };
    }

    const record = asRecord(answer.value);
    const raw = record === null ? undefined : record.jobs;
    if (!Array.isArray(raw)) {
      return { kind: 'missing', reason: 'unusable-answer' };
    }

    if (raw.length === 0) {
      // A run GitHub has observed but has not created jobs for yet. This is the one state that is
      // neither present nor missing: waiting would help, and this call is not going to.
      return { kind: 'pending' };
    }

    const jobs: GitHubCiJobMaterial[] = [];
    for (const entry of raw) {
      const job = readJob(entry);
      if (job === null) {
        return { kind: 'missing', reason: 'unusable-answer' };
      }

      jobs.push(job);
    }

    return { kind: 'present', jobs: Object.freeze(jobs), pending: jobs.some((job) => job.status !== 'completed') };
  }

  async function readLog(
    jobId: number,
    stepName: string | null,
    deadline: number,
  ): Promise<GitHubCiMaterial<GitHubCiLogExcerpt>> {
    const budget = Math.min(requestMs, deadline - Date.now());
    if (budget <= 0) {
      return { kind: 'missing', reason: 'timeout' };
    }

    const path = `/repos/${options.owner}/${options.name}/actions/jobs/${jobId}/logs`;

    let response: Response;
    try {
      // The authenticated first hop is on `api.github.com`; the redirect target is a pre-signed storage
      // URL that authenticates itself. Following it by hand, without the credential, is what makes
      // "the token never leaves the API host" a property of the code instead of a hope about the
      // HTTP client's redirect policy.
      response = await fetch(`${baseUrl}${path}`, {
        method: 'GET',
        headers: headers(true),
        redirect: 'manual',
        signal: AbortSignal.timeout(budget),
      });
    } catch (error) {
      return { kind: 'missing', reason: transportReason(error) };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();

      if (location === null) {
        return { kind: 'missing', reason: 'unusable-answer' };
      }

      let target: URL;
      try {
        target = new URL(location);
      } catch {
        return { kind: 'missing', reason: 'unusable-answer' };
      }

      if (target.protocol !== 'https:') {
        return { kind: 'missing', reason: 'unusable-answer' };
      }

      const remaining = Math.min(requestMs, deadline - Date.now());
      if (remaining <= 0) {
        return { kind: 'missing', reason: 'timeout' };
      }

      try {
        response = await fetch(target, {
          method: 'GET',
          // No credential here, deliberately: this host is not GitHub, and the URL already carries a
          // signature that expires.
          signal: AbortSignal.timeout(remaining),
        });
      } catch (error) {
        return { kind: 'missing', reason: transportReason(error) };
      }
    }

    if (!response.ok) {
      return { kind: 'missing', reason: refusalReason(response) };
    }

    const excerpt = await readLogWindow(response, stepName);
    return { kind: 'present', value: excerpt };
  }

  return {
    async getRunMaterials(query: GitHubCiRunMaterialsQuery): Promise<GitHubCiRunMaterials> {
      const requestedAt = new Date().toISOString();
      const deadline = Date.now() + totalMs;

      // A query for a repository this reader was not configured for is not a read that can be answered
      // honestly, and it is not an exception either: refusing the read and saying so keeps the failure
      // where the caller can see it.
      if (!queryNamesThisRepository(query.repository, reference)) {
        return unusableMaterials(requestedAt, reference, query);
      }

      const jobsAnswer = await readJobList(query, deadline);

      // The jobs answer is the only one that carries its own identity. `run_id` and `head_sha` come
      // back on every job, so no fourth request is needed to answer "is this the run I asked about".
      let identity: 'confirmed' | 'mismatch' = 'mismatch';
      if (jobsAnswer.kind === 'present') {
        const first = jobsAnswer.jobs[0];
        if (first !== undefined) {
          identity =
            firstIdentityMatches(query.runId, query.headSha, first) ? 'confirmed' : 'mismatch';
        }
      }

      const jobs: GitHubCiMaterial<readonly GitHubCiJobMaterial[]> =
        jobsAnswer.kind === 'present'
          ? { kind: 'present', value: jobsAnswer.jobs }
          : jobsAnswer.kind === 'pending'
            ? { kind: 'pending' }
            : { kind: 'missing', reason: jobsAnswer.reason };

      // The diff is keyed by the commit, not by the run, so it is read even when the jobs answer was
      // unusable — an independent material stays independent.
      const changedFiles = await readChangedFiles(query.headSha, deadline);

      let log: GitHubCiMaterial<GitHubCiLogExcerpt>;
      if (jobsAnswer.kind === 'pending') {
        // The run has not finished, so its log is still being written. Reading it now would produce a
        // half-log that looks like a whole one.
        log = { kind: 'pending' };
      } else if (jobsAnswer.kind === 'missing') {
        log = { kind: 'missing', reason: jobsAnswer.reason };
      } else if (identity === 'mismatch') {
        // Reading a log for a run we could not identify would attach the wrong run's output to this
        // one. The jobs material still says what came back; the log refuses to guess.
        log = { kind: 'missing', reason: 'unusable-answer' };
      } else {
        const failingJob = pickFailingJob(jobsAnswer.jobs);
        const stepName = pickFailingStepName(failingJob);
        log =
          failingJob === null
            ? { kind: 'missing', reason: 'unusable-answer' }
            : await readLog(failingJob.id, stepName, deadline);
      }

      return Object.freeze({
        requestedAt,
        repository: reference,
        runId: query.runId,
        headSha: query.headSha,
        identity,
        jobs: freezeMaterial(jobs),
        changedFiles,
        log: freezeMaterial(log),
      });
    },
  };
}

// A reader whose only answer is "nothing could be read". The plugin uses it when its transport is
// broken, so that a failing material path degrades to absence rather than to a rejected promise.
export function unusableRunMaterials(
  query: GitHubCiRunMaterialsQuery,
  requestedAt = new Date().toISOString(),
): GitHubCiRunMaterials {
  return unusableMaterials(requestedAt, query.repository, query);
}

function unusableMaterials(
  requestedAt: string,
  repository: string,
  query: GitHubCiRunMaterialsQuery,
): GitHubCiRunMaterials {
  const jobs: GitHubCiMaterial<readonly GitHubCiJobMaterial[]> = Object.freeze({
    kind: 'missing' as const,
    reason: 'unusable-answer' as const,
  });
  const changedFiles: GitHubCiMaterial<GitHubCiChangedFiles> = Object.freeze({
    kind: 'missing' as const,
    reason: 'unusable-answer' as const,
  });
  const log: GitHubCiMaterial<GitHubCiLogExcerpt> = Object.freeze({
    kind: 'missing' as const,
    reason: 'unusable-answer' as const,
  });

  return Object.freeze({
    requestedAt,
    repository,
    runId: typeof query.runId === 'number' ? query.runId : 0,
    headSha: typeof query.headSha === 'string' ? query.headSha : '',
    identity: 'mismatch' as const,
    jobs,
    changedFiles,
    log,
  });
}

function queryNamesThisRepository(repository: string, reference: string): boolean {
  // Case-insensitive for the reason the history reader states: GitHub resolves owner and name
  // case-insensitively, and a difference in spelling is not a difference in repository.
  return typeof repository === 'string' && repository.toLowerCase() === reference.toLowerCase();
}

function firstIdentityMatches(
  runId: number,
  headSha: string,
  job: GitHubCiJobMaterial,
): boolean {
  return job.runId === runId && job.headSha.toLowerCase() === headSha.toLowerCase();
}

function pickFailingJob(jobs: readonly GitHubCiJobMaterial[]): GitHubCiJobMaterial | null {
  for (const job of jobs) {
    if (job.conclusion === 'failure') {
      return job;
    }
  }

  return null;
}

function pickFailingStepName(job: GitHubCiJobMaterial | null): string | null {
  if (job === null) return null;

  for (const step of job.steps) {
    if (step.conclusion === 'failure') return step.name;
  }

  return null;
}

function readJob(value: unknown): GitHubCiJobMaterial | null {
  const record = asRecord(value);
  if (record === null) return null;

  const id = record.id;
  const runId = record.run_id;
  const headSha = record.head_sha;
  if (typeof id !== 'number' || !Number.isInteger(id)) return null;
  if (typeof runId !== 'number' || !Number.isInteger(runId)) return null;
  if (typeof headSha !== 'string' || headSha === '') return null;

  const name = typeof record.name === 'string' ? record.name : '';
  const status = typeof record.status === 'string' ? record.status : '';
  const conclusion = typeof record.conclusion === 'string' ? record.conclusion : null;

  const steps: GitHubCiMaterialStep[] = [];
  if (Array.isArray(record.steps)) {
    for (const entry of record.steps) {
      const step = asRecord(entry);
      if (step === null) continue;
      steps.push(
        Object.freeze({
          name: typeof step.name === 'string' ? step.name : '',
          conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
        }),
      );
    }
  }

  return Object.freeze({
    id,
    runId,
    headSha,
    name,
    status,
    conclusion,
    steps: Object.freeze(steps),
  });
}

function limitFiles(raw: readonly unknown[]): GitHubCiChangedFiles {
  const files: GitHubCiChangedFile[] = [];
  let linesLeft = MAX_PATCH_LINES_TOTAL;
  let omitted = 0;

  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) {
      omitted += 1;
      continue;
    }

    const filename = typeof record.filename === 'string' ? record.filename : '';
    if (files.length >= MAX_PATCH_FILES) {
      omitted += 1;
      continue;
    }

    const status = typeof record.status === 'string' ? record.status : '';
    const additions = countOf(record.additions);
    const deletions = countOf(record.deletions);
    const patchText = typeof record.patch === 'string' ? record.patch : null;

    let patch: GitHubCiFilePatch;
    if (patchText === null) {
      patch = Object.freeze({ kind: 'absent' as const, why: 'binary' as const });
    } else if (linesLeft <= 0) {
      // The share of the total budget for patches has been used by earlier files.
      patch = Object.freeze({ kind: 'absent' as const, why: 'over-limit' as const });
    } else {
      const limited = limitPatch(patchText, Math.min(MAX_PATCH_LINES_PER_FILE, linesLeft));
      linesLeft -= limited.lines;
      patch = Object.freeze({ kind: 'present' as const, text: limited.text, cut: limited.cut });
    }

    files.push(Object.freeze({ filename, status, additions, deletions, patch }));
  }

  return Object.freeze({
    files: Object.freeze(files),
    totalFiles: raw.length,
    omittedFiles: omitted,
  });
}

function limitPatch(patch: string, maxLines: number): { text: string; lines: number; cut: boolean } {
  const lines = patch.split('\n');
  if (lines.length <= maxLines) {
    return { text: patch, lines: lines.length, cut: false };
  }

  return { text: lines.slice(0, maxLines).join('\n'), lines: maxLines, cut: true };
}

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

async function readLogWindow(
  response: Response,
  stepName: string | null,
): Promise<GitHubCiLogExcerpt> {
  const declared = Number(response.headers.get('content-length'));
  const totalBytes = Number.isFinite(declared) && declared >= 0 ? declared : null;

  const body = response.body;
  if (body === null) {
    return Object.freeze({
      text: '',
      window: 'tail' as const,
      step: stepName,
      bytesRead: 0,
      droppedBytes: 0,
      truncated: false,
      totalBytes,
      ansiStripped: false,
    });
  }

  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let bytesRead = 0;
  let tail = '';
  let slid = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      tail += decoder.decode(value, { stream: true });

      // The window is kept in characters while the limits are in bytes; for the ASCII that CI logs
      // mostly are they are the same number, and `droppedBytes` below reports the real byte count
      // rather than pretending the two units are interchangeable.
      if (tail.length > LOG_WINDOW_BYTES) {
        tail = tail.slice(-LOG_WINDOW_BYTES);
        slid = true;
      }

      if (bytesRead >= LOG_SCAN_LIMIT_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    // A body that broke mid-stream still leaves what already arrived; reporting the part that was
    // read is more useful than reporting nothing, as long as the excerpt says it is a part.
  }

  tail += decoder.decode();

  const hadAnsi = ANSI_PATTERN.test(tail);
  const stripped = stripAnsi(tail);
  const selected = selectWindow(stripped, stepName);
  const keptBytes = Buffer.byteLength(selected.text, 'utf8');

  return Object.freeze({
    text: selected.text,
    window: selected.window,
    step: stepName,
    bytesRead,
    droppedBytes: Math.max(0, bytesRead - keptBytes),
    // Not "the excerpt is shorter than the log" — every anchored excerpt is. This says the read
    // itself stopped before the end of the log: the window had to slide, or the scan limit was hit.
    truncated: slid || bytesRead >= LOG_SCAN_LIMIT_BYTES,
    totalBytes,
    ansiStripped: hadAnsi,
  });
}

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

// GitHub writes a step's output between `##[group]Run <command>` markers, and a failed step also emits
// `##[error]` lines. Anchoring on the failing step and on the error line is what keeps this excerpt
// about the failure: the bytes at the very end of a real log are `git config` output and
// "Cleaning up orphan processes", which is exactly the part a reader does not need.
function selectWindow(text: string, stepName: string | null): { text: string; window: 'failing-step' | 'tail' } {
  const lines = text.split('\n');

  let errorIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index]?.includes('##[error]') === true) {
      errorIndex = index;
      break;
    }
  }

  const upper = errorIndex === -1 ? lines.length - 1 : errorIndex;

  let start = -1;
  if (stepName !== null && stepName !== '') {
    for (let index = upper; index >= 0; index -= 1) {
      const line = lines[index] ?? '';
      if (line.includes('##[group]') && line.includes(stepName)) {
        start = index;
        break;
      }
    }
  }

  if (start === -1) {
    for (let index = upper; index >= 0; index -= 1) {
      if (lines[index]?.includes('##[group]') === true) {
        start = index;
        break;
      }
    }
  }

  if (start === -1) {
    return { text, window: 'tail' };
  }

  // The excerpt ends where the next block begins, not at the end of the log: after the failing step
  // GitHub writes the steps that clean up, and a real log's last lines are git config output and
  // "Cleaning up orphan processes". Cutting at end-of-log is exactly the mistake the real readings
  // corrected (§12.11).
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index]?.includes('##[group]') === true) {
      end = index;
      break;
    }
  }

  return { text: lines.slice(start, end).join('\n'), window: 'failing-step' };
}

function refusalReason(response: Response): GitHubCiMaterialGap {
  if (response.status === 404) return 'not-found';
  if (response.status === 429) return 'rate-limited';
  if (response.headers.get('x-ratelimit-remaining') === '0') return 'rate-limited';
  if (response.status === 401 || response.status === 403) return 'authentication';

  // 5xx: the server answered, and what it answered is that it could not answer. That is a transport
  // outcome for this module's purposes, not an unreadable body.
  if (response.status >= 500) return 'transport';

  return 'unusable-answer';
}

function transportReason(error: unknown): GitHubCiMaterialGap {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  if (error instanceof Error && error.name === 'AbortError') return 'timeout';

  return 'transport';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

function freezeMaterial<T>(material: GitHubCiMaterial<T>): GitHubCiMaterial<T> {
  return Object.freeze({ ...material }) as GitHubCiMaterial<T>;
}
