// The TypeScript side's answers, for the cases both implementations have to agree on.
//
// This exists because HumanSurface.Core.DeliveryFraming and DeliveryEndpointPath are a second
// statement of what `src/human-delivery/protocol.ts` and `endpoint-path.ts` already say. A second
// statement that is never compared is a copy that drifts; this is the comparison. It runs the real
// functions out of `dist/`, so what it reports is the shipping behaviour rather than a restatement
// of it in another language.
//
// One process, one JSON document, both directions: the wire bytes Node produces (which the C# decoder
// must accept) and the lines Node accepts (which the C# decoder must accept or reject identically).
// Called with the repository root.

import { pathToFileURL } from 'node:url';
import { basename } from 'node:path';

const root = process.argv[2];
const mod = await import(pathToFileURL(`${root}/dist/human-delivery/index.js`).href);
const { encodeDelivery, decodeDelivery, humanDeliveryEndpointPath } = mod;

// Spellings of the same directory that a person or a script could plausibly use. The last two are
// directories that do not exist: a client may connect before anything has created the data
// directory, so the lexical fallback is an ordinary path rather than an error path.
const pathInputs = [
  root,
  root.toUpperCase(),
  `${root}\\`,
  `${root}\\..\\${basename(root)}`,
  `${root}\\a-directory-that-does-not-exist`,
  'Z:\\no-such-directory\\hikari-data',
];

// Content the decoder has to carry through untouched: indentation the renderer emits, CJK, the
// escape characters JSON cares about, and the empty string.
const encodeInputs = [
  [],
  ['one line'],
  ['header', '  indented', ''],
  ['Desktop return attention：', '  观察时间：15:34:55', '  全角　空格'],
  ['引号 " 和反斜杠 \\ 和制表符 \t'],
  ['emoji 🙂 and a newline escape \\n that is not a newline'],
];

// Lines that are frames, lines that are not, and lines that are almost frames. `[1,2]` and
// `["ok",null]` are the ones a permissive decoder accepts; `'  ["padded"]  '` is the one a strict
// decoder rejects.
const decodeInputs = [
  '[]',
  '["a"]',
  '["a","b"]',
  '[""]',
  'not json',
  '{"a":1}',
  '"a string"',
  '[1,2]',
  '["ok",1]',
  '["ok",null]',
  '["unterminated"',
  'null',
  '',
  '  ["padded"]  ',
  '["a"]\n',
];

process.stdout.write(
  `${JSON.stringify({
    paths: pathInputs.map((input) => ({ input, node: humanDeliveryEndpointPath(input) ?? null })),
    encodes: encodeInputs.map((lines) => ({ lines, wire: encodeDelivery(lines) })),
    decodes: decodeInputs.map((wire) => ({ wire, node: decodeDelivery(wire) ?? null })),
  })}\n`,
);
