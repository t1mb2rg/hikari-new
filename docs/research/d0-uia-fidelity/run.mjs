// Runner for the D0 probes.
//
//   node run.mjs <config.json> <output.json> [script.ps1]
//
// `script.ps1` defaults to uia-matrix.ps1 (the strategy matrix); pass uia-consistency.ps1 for the
// internal-coherence probe. Both are read-only.
//
// The probe runs via `-File`, not `-EncodedCommand`. That is deliberate: `-EncodedCommand` takes the
// whole script as one command-line argument, and this script base64-encodes to well past the ~32 KB
// Windows command-line ceiling (the first attempt failed with ENAMETOOLONG). `-File` also makes the
// reproduction instructions a command someone can read and retype.
//
// The config travels as base64 JSON in an environment variable, because Windows PowerShell 5.1 has no
// clean way to pass structured arguments to a `-File` script.
//
// This script only spawns the read-only probe. It performs no GUI operation.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [, , configArg = 'config.json', outArg = 'last-run.json', scriptArg = 'uia-matrix.ps1'] = process.argv;

const configPath = resolve(here, configArg);
const outPath = resolve(here, outArg);

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const scriptPath = join(here, scriptArg);

const encode = (s, enc) => Buffer.from(s, enc).toString('base64');

const started = Date.now();
let stdout;
try {
  stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', scriptPath],
    {
      windowsHide: true,
      timeout: Number(config.hardTimeoutMs ?? 900_000),
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, HIKARI_PROBE_CONFIG_B64: encode(JSON.stringify(config), 'utf8') },
    },
  );
} catch (err) {
  console.error('probe failed:', err.message);
  if (err.stdout) console.error(String(err.stdout).slice(0, 4000));
  if (err.stderr) console.error(String(err.stderr).slice(0, 4000));
  process.exit(1);
}

const trimmed = stdout.trim();
let parsed;
try {
  parsed = JSON.parse(trimmed);
} catch {
  console.error('probe returned non-JSON output:');
  console.error(trimmed.slice(0, 4000));
  process.exit(1);
}

parsed.wallClockMs = Date.now() - started;
writeFileSync(outPath, JSON.stringify(parsed, null, 2));
console.log(`wrote ${outPath} (${parsed.windowCount} window(s), ${parsed.wallClockMs} ms wall clock)`);
