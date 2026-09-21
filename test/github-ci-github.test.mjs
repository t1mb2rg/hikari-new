import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { GitHubCiObservationError } from '../dist/github-ci/index.js';

// The real acquirer, against a server that speaks GitHub's shape. Internal on purpose, exactly as
// the git provider's own module-level test is: the seam these tests exercise is not configuration,
// and the plugin never passes either of these options.
import { createGitHubCiAcquirer } from '../dist/github-ci/github.js';

const OWNER = 't1mb2rg';
const NAME = 'hikari-new';
const REPOSITORY_PATH = `/repos/${OWNER}/${NAME}`;
const RUNS_PATH = `${REPOSITORY_PATH}/actions/runs?per_page=1`;

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

async function serve(t, routes) {
  const seen = [];
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    const route = routes[request.url];
    if (route === undefined) {
      json(response, 404, { message: 'Not Found', status: '404' });
      return;
    }
    route(request, response);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  return { baseUrl: `http://127.0.0.1:${server.address().port}`, seen };
}

function repositoryBody(fullName) {
  return { full_name: fullName, name: fullName.split('/')[1], private: false, default_branch: 'main' };
}

function runBody(overrides = {}) {
  return {
    id: 8100000001,
    name: 'Runtime Tests',
    head_branch: 'main',
    head_sha: 'c'.repeat(40),
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  };
}

function runsBody(runs) {
  return { total_count: runs.length, workflow_runs: runs };
}

function acquirerFor(baseUrl, timeoutMs) {
  return createGitHubCiAcquirer({ owner: OWNER, name: NAME, baseUrl, timeoutMs });
}

test('an observation is two unauthenticated GETs: the repository, then its most recent run', async (t) => {
  const { baseUrl, seen } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) => json(response, 200, runsBody([runBody()])),
  });

  await acquirerFor(baseUrl).acquire();

  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.map((request) => `${request.method} ${request.url}`),
    [`GET ${REPOSITORY_PATH}`, `GET ${RUNS_PATH}`],
  );
});

test('no credential of any kind is sent, and the API version is stated', async (t) => {
  const { baseUrl, seen } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) => json(response, 200, runsBody([runBody()])),
  });

  await acquirerFor(baseUrl).acquire();

  for (const request of seen) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers['x-github-api-version'], '2022-11-28');
    assert.equal(request.headers.accept, 'application/vnd.github+json');
  }
});

test("the repository is reported under GitHub's spelling, not the one it was asked about", async (t) => {
  // Both spellings are answered, because that is what GitHub does: it resolves owner and name
  // case-insensitively and answers 200 either way, with its own spelling in the body. Which is why
  // the name in the observation is a fact about the repository and not an echo of the config.
  const asked = '/repos/T1MB2RG/HIKARI-NEW';
  const { baseUrl } = await serve(t, {
    [asked]: (request, response) => json(response, 200, repositoryBody('t1mb2rg/hikari-new')),
    [`${asked}/actions/runs?per_page=1`]: (request, response) =>
      json(response, 200, runsBody([runBody()])),
  });

  const acquirer = createGitHubCiAcquirer({ owner: 'T1MB2RG', name: 'HIKARI-NEW', baseUrl });
  const acquisition = await acquirer.acquire();

  assert.equal(acquisition.repository, 't1mb2rg/hikari-new');
});

test('a run that has not concluded carries no conclusion, and the run is still reported', async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) =>
      json(response, 200, runsBody([runBody({ status: 'in_progress', conclusion: null })])),
  });

  const acquisition = await acquirerFor(baseUrl).acquire();

  assert.equal(acquisition.latestRun.kind, 'reported');
  assert.equal(acquisition.latestRun.run.status, 'in_progress');
  assert.deepEqual(acquisition.latestRun.run.conclusion, { kind: 'absent' });
});

test('a repository GitHub reports no runs for is reported as having none', async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) => json(response, 200, runsBody([])),
  });

  const acquisition = await acquirerFor(baseUrl).acquire();

  assert.deepEqual(acquisition.latestRun, { kind: 'none' });
});

test("a finished run's status and conclusion are passed through as GitHub's own words", async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) =>
      json(response, 200, runsBody([runBody({ status: 'completed', conclusion: 'failure' })])),
  });

  const acquisition = await acquirerFor(baseUrl).acquire();

  assert.equal(acquisition.latestRun.run.status, 'completed');
  assert.deepEqual(acquisition.latestRun.run.conclusion, { kind: 'reported', value: 'failure' });
  assert.equal(acquisition.latestRun.run.workflow, 'Runtime Tests');
  assert.equal(acquisition.latestRun.run.headBranch, 'main');
  assert.equal(acquisition.latestRun.run.headSha, 'c'.repeat(40));
});

test('a rejection quotes what GitHub said, including a 404 that is not about this module failing', async (t) => {
  const { baseUrl } = await serve(t, {});

  await assert.rejects(acquirerFor(baseUrl).acquire(), (error) => {
    assert.ok(error instanceof GitHubCiObservationError);
    assert.match(error.message, /HTTP 404/);
    assert.match(error.message, /GitHub said: Not Found/);
    return true;
  });
});

test('an exhausted quota is named as the reason, with the moment it lifts', async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) =>
      json(
        response,
        403,
        { message: 'API rate limit exceeded for 203.0.113.1.' },
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
      ),
  });

  await assert.rejects(acquirerFor(baseUrl).acquire(), (error) => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /quota is exhausted until \d{4}-\d{2}-\d{2}T/);
    return true;
  });
});

test('an answer that is not JSON is a failure, not an empty observation', async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>not json</html>');
    },
  });

  await assert.rejects(acquirerFor(baseUrl).acquire(), /body that is not JSON/);
});

test('an answer missing a fact it needs is a failure rather than a run with a hole in it', async (t) => {
  const { baseUrl } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
    [RUNS_PATH]: (request, response) => {
      const run = runBody();
      delete run.head_sha;
      json(response, 200, runsBody([run]));
    },
  });

  await assert.rejects(acquirerFor(baseUrl).acquire(), /head_sha/);
});

test('a host that refuses the connection fails the observation, naming the reason', async (t) => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));

  await assert.rejects(acquirerFor(`http://127.0.0.1:${port}`).acquire(), (error) => {
    assert.ok(error instanceof GitHubCiObservationError);
    assert.match(error.message, /ECONNREFUSED/);
    return true;
  });
});

test('a host that never answers fails the observation as a timeout', async (t) => {
  const { baseUrl } = await serve(t, { [REPOSITORY_PATH]: () => {} });

  await assert.rejects(acquirerFor(baseUrl, 50).acquire(), /no answer within 50 ms/);
});

test('disposing aborts an observation that is in flight', async (t) => {
  const { baseUrl } = await serve(t, { [REPOSITORY_PATH]: () => {} });
  const acquirer = acquirerFor(baseUrl);

  const inFlight = acquirer.acquire();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await acquirer.dispose();

  await assert.rejects(inFlight, /disposed/);
});

test('an observation taken after disposal never reaches the network', async (t) => {
  const { baseUrl, seen } = await serve(t, {
    [REPOSITORY_PATH]: (request, response) => json(response, 200, repositoryBody(`${OWNER}/${NAME}`)),
  });
  const acquirer = acquirerFor(baseUrl);

  await acquirer.dispose();
  await assert.rejects(acquirer.acquire(), /disposed/);

  assert.equal(seen.length, 0);
});
