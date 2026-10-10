// Runner for the responsiveness experiment.
//
//   node run-blocking.mjs <config.json> <output.json>
//
// Two processes run at once, and neither of them touches the other:
//
//   uia-ping.ps1       pings the target window with WM_NULL and timestamps every response
//   uia-walk-once.ps1  runs one ControlView walk over the same window, stamped start and end
//
// The question is whether the second starves the first. WM_NULL is a no-op, so a window that is
// pumping its message queue answers in well under a millisecond; a window whose UI thread is blocked
// cannot answer until it unblocks. Correlating the two series by epoch time splits the pings into
// before / during / after the walk.
//
// This spawns a read-only probe and a read-only measurement. No GUI operation.
//
// Both children exit on their own (the pinger's duration is sized to outlast the walker), so nothing
// is killed and no output is lost to a signal.

import { execFile, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , configArg = 'blocking.json', outArg = 'blocking-1.json'] = process.argv;

const config = JSON.parse(readFileSync(resolve(here, configArg), 'utf8'));
const outPath = resolve(here, outArg);

const encode = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The pinger must outlive baseline + walk + tail without being signalled.
const pingerDuration = config.baselineMs + config.walk.timeBudgetMs + config.tailMs + 4000;

function runPinger(target) {
  return new Promise((res, rej) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-File', join(here, 'uia-ping.ps1')],
      {
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
        encoding: 'utf8',
        timeout: pingerDuration + 60_000,
        env: {
          ...process.env,
          HIKARI_PING_CONFIG_B64: encode({
            target,
            durationMs: pingerDuration,
            timeoutMs: config.pingTimeoutMs,
            intervalMs: config.pingIntervalMs,
          }),
        },
      },
      (err, stdout, stderr) => {
        if (err) return rej(new Error(`pinger failed: ${err.message}\n${stderr ?? ''}`));
        res(JSON.parse(stdout.trim()));
      },
    );
  });
}

function runWalker(target) {
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', join(here, 'uia-walk-once.ps1')],
    {
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      timeout: config.walk.timeBudgetMs + 60_000,
      env: {
        ...process.env,
        HIKARI_WALK_CONFIG_B64: encode({ target, ...config.walk }),
      },
    },
  );
  return JSON.parse(stdout.trim());
}

function stats(samples) {
  if (!samples.length) return { count: 0 };
  const rtts = samples.map((s) => s.rtt).sort((a, b) => a - b);
  const at = (q) => rtts[Math.min(rtts.length - 1, Math.floor(q * rtts.length))];
  return {
    count: samples.length,
    timeouts: samples.filter((s) => s.to).length,
    maxMs: rtts[rtts.length - 1],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
  };
}

const results = [];

for (const target of config.targets) {
  const pingerPromise = runPinger(target);
  await sleep(config.baselineMs);          // let the baseline accumulate before the walk starts
  const walk = runWalker(target);          // blocks this process; the pinger runs in its own
  await sleep(config.tailMs);              // let the window recover before the pinger stops
  const ping = await pingerPromise;

  if (ping.error) {
    results.push({ target, error: ping.error, walk });
    continue;
  }

  const before = ping.samples.filter((s) => s.abs < walk.startMs);
  const during = ping.samples.filter((s) => s.abs >= walk.startMs && s.abs <= walk.endMs);
  const after = ping.samples.filter((s) => s.abs > walk.endMs);

  results.push({
    target,
    hwnd: ping.hwnd,
    walk: { ...walk, pingHwndMatches: ping.hwnd === walk.hwnd },
    pingTimeoutMs: ping.timeoutMs,
    baseline: stats(before),
    duringWalk: stats(during),
    after: stats(after),
  });
}

const out = { config, results, wallClockMs: Date.now() };
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}`);
for (const r of results) {
  if (r.error) { console.log(`${r.target}: ERROR ${r.error}`); continue; }
  const f = (s) => `n=${s.count} to=${s.timeouts} p50=${s.p50} p95=${s.p95} max=${s.maxMs}`;
  console.log(`${r.target}: walk ${r.walk.wallMs}ms (${r.walk.nodes} nodes, ${r.walk.textChars} chars)`);
  console.log(`   before ${f(r.baseline)}`);
  console.log(`   during ${f(r.duringWalk)}`);
  console.log(`   after  ${f(r.after)}`);
}
