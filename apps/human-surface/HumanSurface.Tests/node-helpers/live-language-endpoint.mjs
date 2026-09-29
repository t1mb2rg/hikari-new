// A real language endpoint, for the C# client to be tested against.
//
// It is the repository's own `listenLanguageEndpoint`, so what the live tests exercise is the shipping
// server rather than a stand-in for it: the framing, the decode, the `failed`-on-a-malformed-envelope
// rule and the `end(encodeLanguageReply(...))` teardown are all the module's. It is reached by file
// path rather than through the package's barrel, which exports the derivation and the vocabulary but
// not the listener — the listener has no caller outside the plugin, and `plugin.ts` reaches it the same
// way.
//
// The *answer* is chosen here, which is the same seam `plugin.ts` uses when it injects a model factory:
// every question about whether a model's words can reach a human is a question about what happens to
// the model's answer, and a test answers it by choosing that answer rather than by standing up
// something that pretends to be a model. Nothing here claims a model was involved.
//
//   node live-language-endpoint.mjs <rootDir> <replyJson | hold>
//
// Prints `READY <pipePath>` once listening and `ASKED` when a request has been framed and handed over.
// Commands arrive on stdin, one per line: `close` closes the endpoint, `exit` ends the process.

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const [rootDir, replyJson] = process.argv.slice(2);

const { languageEndpointPath } = await import(
  pathToFileURL(`${rootDir}/dist/language/index.js`).href
);
const { listenLanguageEndpoint } = await import(
  pathToFileURL(`${rootDir}/dist/language/endpoint.js`).href
);

// `hold` is a connection that never gets an answer. It is how a client that is waiting is told apart
// from a client that has given up: the request framed, the server took it, and then the endpoint went
// away underneath it.
const matching = replyJson === 'hold' ? null : JSON.parse(replyJson);

const endpoint = await listenLanguageEndpoint(
  {
    handle: async () => {
      process.stdout.write('ASKED\n');
      if (matching === null) return new Promise(() => {});
      return matching;
    },
  },
  languageEndpointPath(rootDir),
);

process.stdout.write(`READY ${endpoint.path}\n`);

const commands = createInterface({ input: process.stdin });

for await (const line of commands) {
  const command = line.trim();

  if (command === 'close') {
    await endpoint.close();
    process.stdout.write('CLOSED\n');
  }

  if (command === 'exit') break;
}

process.exit(0);
