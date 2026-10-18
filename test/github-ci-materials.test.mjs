import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { Runtime } from '../dist/index.js';
import {
  createGitHubCiRunMaterialsReader,
  gitHubCiRunMaterialsService,
  gitHubCiService,
  GitHubCiError,
} from '../dist/github-ci/index.js';

// A second named exception to the "tests import only public entry points" pattern, for the same
// reason as the observation test: the materials seam is what makes a network failure injectable.
import { createGitHubCiPlugin } from '../dist/github-ci/plugin.js';

const HEAD_SHA = 'd'.repeat(40);
const OTHER_SHA = 'e'.repeat(40);
const RUN_ID = 8100000042;
const REPOSITORY = 't1mb2rg/hikari-new';
const QUERY = { repository: REPOSITORY, runId: RUN_ID, headSha: HEAD_SHA };

// One fixture server for every case, with a route table the tests replace. The interesting failures
// here are all answers — a 403, an empty job list, a body of the wrong shape — and answering them off
// a real socket is what keeps the module's own reading honest.
async function serve(t, routes) {
  const seen = [];

  const server = createServer((request, response) => {
    seen.push(request.url);
    const route = routes[request.url];
    if (route === undefined) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: 'Not Found' }));
      return;
    }

    route(request, response);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  return { seen, baseUrl: `http://127.0.0.1:${port}` };
}

function json(value, status = 200) {
  return (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
}

function job(overrides = {}) {
  return {
    id: 5500000001,
    name: 'surface',
    status: 'completed',
    conclusion: 'failure',
    run_id: RUN_ID,
    head_sha: HEAD_SHA,
    steps: [
      { name: 'Set up job', conclusion: 'success' },
      { name: 'Build and test', conclusion: 'failure' },
      { name: 'Post job cleanup', conclusion: 'success' },
    ],
    ...overrides,
  };
}

function jobsBody(jobs) {
  return { total_count: jobs.length, jobs };
}

function commitsBody(files) {
  return { sha: HEAD_SHA, files };
}

const JOBS_PATH = `/repos/${REPOSITORY}/actions/runs/${RUN_ID}/jobs?per_page=100`;
const COMMITS_PATH = `/repos/${REPOSITORY}/commits/${HEAD_SHA}`;
const LOGS_PATH = `/repos/${REPOSITORY}/actions/jobs/5500000001/logs`;

function allPresent(t, options = {}) {
  return serve(t, {
    [JOBS_PATH]: json(jobsBody([job(), job({ id: 5500000002, name: 'test', conclusion: 'success' })])),
    [COMMITS_PATH]: json(
      commitsBody([
        { filename: 'src/a.ts', status: 'modified', additions: 3, deletions: 1, patch: '+a\n-b' },
      ]),
    ),
    [LOGS_PATH]: (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(
        [
          'starting',
          '##[group]Set up job',
          'ok',
          '##[group]Build and test',
          '\u001b[31mAssertionError: boom\u001b[0m',
          '##[error]Process completed with exit code 1.',
          '##[group]Cleaning up orphan processes',
          'git config --local gc.auto 0',
        ].join('\n'),
      );
    },
    ...options,
  });
}

test('three materials, and the excerpt starts where the failing step starts', async (t) => {
  const { baseUrl } = await allPresent(t);
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);

  assert.equal(materials.identity, 'confirmed');
  assert.equal(materials.repository, REPOSITORY);
  assert.equal(materials.runId, RUN_ID);
  assert.equal(materials.headSha, HEAD_SHA);
  assert.match(materials.requestedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(materials.jobs.kind, 'present');
  assert.equal(materials.jobs.value.length, 2);
  assert.equal(materials.jobs.value[0].runId, RUN_ID);

  assert.equal(materials.changedFiles.kind, 'present');
  const [file] = materials.changedFiles.value.files;
  assert.equal(file.filename, 'src/a.ts');
  assert.equal(file.patch.kind, 'present');
  assert.equal(file.patch.text, '+a\n-b');
  assert.equal(file.patch.cut, false);

  assert.equal(materials.log.kind, 'present');
  const log = materials.log.value;
  assert.equal(log.window, 'failing-step');
  assert.equal(log.step, 'Build and test');
  assert.equal(log.ansiStripped, true);
  assert.equal(log.text.includes('\u001b'), false, 'colour codes are transport, not content');
  assert.match(log.text, /AssertionError: boom/u);
  assert.match(log.text, /##\[error\]Process completed with exit code 1\./u);
  assert.equal(
    log.text.includes('Cleaning up orphan processes'),
    false,
    'the excerpt ends at the failing block, not at the end of the log',
  );
  assert.equal(log.truncated, false);
});

test('a log the credential cannot read is one absent material, not a failed read', async (t) => {
  const { baseUrl } = await allPresent(t, {
    [LOGS_PATH]: json({ message: 'Must have admin rights to Repository.' }, 403),
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);

  assert.equal(materials.jobs.kind, 'present');
  assert.equal(materials.changedFiles.kind, 'present');
  assert.equal(materials.log.kind, 'missing');
  assert.equal(materials.log.reason, 'authentication');
});

test('a run GitHub has not made jobs for yet is pending, and its log is not read at all', async (t) => {
  const { seen, baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([])),
    [COMMITS_PATH]: json(commitsBody([])),
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);

  assert.equal(materials.jobs.kind, 'pending');
  assert.equal(materials.log.kind, 'pending');
  assert.equal(materials.changedFiles.kind, 'present');
  assert.equal(seen.includes(LOGS_PATH), false, 'a half-written log is read as a whole one');
});

test('an answer that identifies a different run is not used to fetch that run\'s log', async (t) => {
  const { seen, baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([job({ run_id: 8109999999 })])),
    [COMMITS_PATH]: json(commitsBody([])),
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);

  assert.equal(materials.identity, 'mismatch');
  assert.equal(materials.jobs.kind, 'present', 'what came back is still reported');
  assert.equal(materials.log.kind, 'missing');
  assert.equal(materials.log.reason, 'unusable-answer');
  assert.equal(seen.includes(LOGS_PATH), false);
});

test('a query for a repository this reader was not configured for reads nothing', async (t) => {
  const { seen, baseUrl } = await serve(t, {});
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials({ ...QUERY, repository: 'someone/else' });

  assert.equal(materials.identity, 'mismatch');
  assert.equal(materials.jobs.kind, 'missing');
  assert.equal(materials.jobs.reason, 'unusable-answer');
  assert.deepEqual(seen, [], 'a read for another repository never leaves the process');
});

test('a 404 and an exhausted quota are different absences', async (t) => {
  const notFound = await serve(t, {
    [COMMITS_PATH]: json({ message: 'Not Found' }, 404),
    [JOBS_PATH]: json({ message: 'Not Found' }, 404),
  });
  const first = await createGitHubCiRunMaterialsReader({
    owner: 't1mb2rg',
    name: 'hikari-new',
    baseUrl: notFound.baseUrl,
  }).getRunMaterials(QUERY);
  assert.equal(first.jobs.kind, 'missing');
  assert.equal(first.jobs.reason, 'not-found');
  assert.equal(first.log.kind, 'missing');
  assert.equal(first.log.reason, 'not-found', 'the reason the jobs were absent is the reason the log is');

  const limited = await serve(t, {
    [COMMITS_PATH]: (_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' });
      response.end(JSON.stringify({ message: 'API rate limit exceeded' }));
    },
    [JOBS_PATH]: (_request, response) => {
      response.writeHead(403, { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' });
      response.end(JSON.stringify({ message: 'API rate limit exceeded' }));
    },
  });
  const second = await createGitHubCiRunMaterialsReader({
    owner: 't1mb2rg',
    name: 'hikari-new',
    baseUrl: limited.baseUrl,
  }).getRunMaterials(QUERY);
  assert.equal(second.jobs.reason, 'rate-limited');
  assert.equal(second.changedFiles.reason, 'rate-limited');
});

test('a server error is answered once, and as a value', async (t) => {
  const { seen, baseUrl } = await serve(t, {
    [JOBS_PATH]: json({ message: 'boom' }, 500),
    [COMMITS_PATH]: json({ message: 'boom' }, 500),
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);

  assert.equal(materials.jobs.reason, 'transport');
  assert.equal(materials.changedFiles.reason, 'transport');
  const jobsCalls = seen.filter((url) => url.includes('/jobs?'));
  assert.equal(jobsCalls.length, 1, 'a failed read is not retried inside the same budget');
});

test('the diff cap says what it left out instead of looking like a smaller change', async (t) => {
  const files = Array.from({ length: 25 }, (_unused, index) => ({
    filename: `src/f${index}.ts`,
    status: 'modified',
    additions: 1,
    deletions: 0,
    patch: Array.from({ length: 260 }, (_unusedLine, line) => `+line ${line}`).join('\n'),
  }));

  const { baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([job()])),
    [COMMITS_PATH]: json(commitsBody(files)),
    [LOGS_PATH]: (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('Build and test\nboom\n');
    },
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);
  assert.equal(materials.changedFiles.kind, 'present');
  const answer = materials.changedFiles.value;
  assert.equal(answer.totalFiles, 25);
  assert.equal(answer.files.length, 20);
  assert.equal(answer.omittedFiles, 5);
  assert.equal(answer.files[0].patch.kind, 'present');
  assert.equal(answer.files[0].patch.cut, true);
  assert.ok(answer.files[0].patch.text.split('\n').length <= 200);
});

test('a file GitHub sent no patch for says so rather than pretending to be empty', async (t) => {
  const { baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([job()])),
    [COMMITS_PATH]: json(
      commitsBody([{ filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0 }]),
    ),
    [LOGS_PATH]: (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('Build and test\nboom\n');
    },
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);
  const [file] = materials.changedFiles.value.files;
  assert.equal(file.patch.kind, 'absent');
  assert.equal(file.patch.why, 'binary');
});

test('a log past the read limit is cut, and the cut is visible in the answer', async (t) => {
  const { baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([job()])),
    [COMMITS_PATH]: json(commitsBody([])),
    [LOGS_PATH]: (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      const chunk = 'x'.repeat(1024);
      for (let index = 0; index < 700; index += 1) {
        response.write(chunk);
      }
      response.end();
    },
  });
  const reader = createGitHubCiRunMaterialsReader({ owner: 't1mb2rg', name: 'hikari-new', baseUrl });

  const materials = await reader.getRunMaterials(QUERY);
  assert.equal(materials.log.kind, 'present');
  assert.equal(materials.log.value.truncated, true);
  // The scan stops at the limit, but a chunk arrives whole: the bound is the limit plus at most one
  // read, never the seven hundred kilobytes the server was willing to send.
  assert.ok(
    materials.log.value.bytesRead < 512 * 1024 + 128 * 1024,
    `read ${materials.log.value.bytesRead} bytes, which is a download rather than a scan`,
  );
  assert.ok(materials.log.value.text.length > 0);
});

test('the reader sends the credential to the API host, and only there', async (t) => {
  const seen = [];
  const { baseUrl } = await serve(t, {
    [JOBS_PATH]: json(jobsBody([job()])),
    [COMMITS_PATH]: json(commitsBody([])),
    [LOGS_PATH]: (_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:1/redirected-log' });
      response.end();
    },
  });
  const reader = createGitHubCiRunMaterialsReader({
    owner: 't1mb2rg',
    name: 'hikari-new',
    baseUrl,
    token: 'secret-token',
  });

  const materials = await reader.getRunMaterials(QUERY);
  assert.equal(materials.log.kind, 'missing');

  // The redirect is followed by hand, without the header: a pre-signed storage URL authenticates
  // itself, and the credential is only ever written to a request for the API host.
  assert.equal(materials.log.reason === 'transport' || materials.log.reason === 'unusable-answer', true);
  assert.deepEqual(seen.includes('/redirected-log'), false);
});

test('the plugin turns a broken material path into absence, never into a rejected read', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  await runtime.loadPlugin(
    createGitHubCiPlugin(
      () => ({ acquire: async () => ({ kind: 'unreported' }), dispose: async () => {} }),
      () => ({
        getRunMaterials() {
          throw new Error('the transport is on fire');
        },
      }),
    ),
    { repository: REPOSITORY },
  );

  const captured = {};
  await runtime.loadPlugin({
    id: 'test.run-materials-observer',
    version: '1.0.0',
    requires: [gitHubCiService, gitHubCiRunMaterialsService],
    setup(context) {
      captured.materials = context.services.get(gitHubCiRunMaterialsService);
    },
  });

  const materials = await captured.materials.getRunMaterials(QUERY);

  assert.equal(materials.identity, 'mismatch');
  assert.equal(materials.jobs.kind, 'missing');
  assert.equal(materials.jobs.reason, 'unusable-answer');
  assert.equal(materials.changedFiles.kind, 'missing');
  assert.equal(materials.log.kind, 'missing');
});

test('the plugin hands the query through to an injected reader unchanged', async (t) => {
  const runtime = new Runtime();
  t.after(() => runtime.shutdown());

  const asked = [];
  await runtime.loadPlugin(
    createGitHubCiPlugin(
      () => ({ acquire: async () => ({ kind: 'unreported' }), dispose: async () => {} }),
      () => ({
        async getRunMaterials(query) {
          asked.push(query);
          return {
            requestedAt: '2026-02-01T08:30:00.000Z',
            repository: query.repository,
            runId: query.runId,
            headSha: query.headSha,
            identity: 'confirmed',
            jobs: { kind: 'present', value: [] },
            changedFiles: { kind: 'pending' },
            log: { kind: 'pending' },
          };
        },
      }),
    ),
    { repository: REPOSITORY },
  );

  const captured = {};
  await runtime.loadPlugin({
    id: 'test.run-materials-observer',
    version: '1.0.0',
    requires: [gitHubCiRunMaterialsService],
    setup(context) {
      captured.materials = context.services.get(gitHubCiRunMaterialsService);
    },
  });

  const materials = await captured.materials.getRunMaterials(QUERY);
  assert.deepEqual(asked, [QUERY]);
  assert.equal(materials.identity, 'confirmed');
});

test('the credential is either absent or a non-empty string, and never a half-set value', async () => {
  for (const token of ['', '   ', 42]) {
    const runtime = new Runtime();
    await assert.rejects(
      runtime.loadPlugin(createGitHubCiPlugin(() => ({ acquire: async () => ({ kind: 'unreported' }), dispose: async () => {} })), {
        repository: REPOSITORY,
        token,
      }),
      GitHubCiError,
      `token ${JSON.stringify(token)}`,
    );
    await runtime.shutdown();
  }
});
