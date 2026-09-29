// A real delivery endpoint, for the C# client to be tested against.
//
// It is the repository's own `listenDeliveryEndpoint` — the same module the resident loads — so what
// the live tests exercise is the shipping server rather than a stand-in for it. Commands arrive on
// stdin, one per line, so the test decides when a message is written and when the resident stops
// rather than the two sides racing a sleep.
//
//   node live-endpoint.mjs <dist/human-delivery/index.js> <rootDir> <payloadJson>
//
// Prints `READY <pipePath>` once listening, then `WROTE <outcome>` per write.

import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';

const [modulePath, rootDir, payloadJson] = process.argv.slice(2);

const { listenDeliveryEndpoint, humanDeliveryEndpointPath } = await import(pathToFileURL(modulePath).href);

const endpoint = await listenDeliveryEndpoint(humanDeliveryEndpointPath(rootDir));
process.stdout.write(`READY ${endpoint.path}\n`);

const payload = JSON.parse(payloadJson);
const commands = createInterface({ input: process.stdin });

for await (const line of commands) {
  const command = line.trim();

  if (command === 'write') {
    const outcome = await endpoint.write(payload);
    process.stdout.write(`WROTE ${JSON.stringify(outcome)}\n`);
  }

  // Ends the process, and with it the pipe handle — which is what a resident stopping looks like
  // from the far end. Not `endpoint.close()`, because a client must see the same thing either way
  // and the abrupt one is the case worth pinning.
  if (command === 'exit') break;
}

process.exit(0);
