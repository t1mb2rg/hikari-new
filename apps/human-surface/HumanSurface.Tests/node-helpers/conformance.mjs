// The TypeScript side's answers, for the cases both implementations have to agree on.
//
// This exists because HumanSurface.Core's framing classes and endpoint path derivations are a second
// statement of what `src/human-delivery/` and `src/language/` already say. A second statement that is
// never compared is a copy that drifts; this is the comparison. It runs the real functions out of
// `dist/`, so what it reports is the shipping behaviour rather than a restatement of it in another
// language.
//
// One process, one JSON document, both directions: the wire bytes Node produces (which the C# decoder
// must accept) and the lines Node accepts (which the C# decoder must accept or reject identically). The
// language half adds a third direction, because the two ends of that pipe are not symmetric — C# writes
// requests and Node reads them, so the requests to decode are the ones C# encoded, and they arrive on
// standard input.
//
//   node conformance.mjs <rootDir>
//
// Standard input is a JSON array of `{ text, wire }` with lower-case keys, where `wire` is what the C#
// encoder produced for `text`. An empty array is the ordinary case for a caller that only wants the
// delivery half.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.argv[2];

const delivery = await import(pathToFileURL(`${root}/dist/human-delivery/index.js`).href);
const language = await import(pathToFileURL(`${root}/dist/language/index.js`).href);
const ask = await import(pathToFileURL(`${root}/dist/cli/ask.js`).href);

const { encodeDelivery, decodeDelivery, humanDeliveryEndpointPath } = delivery;

// Spellings of the same directory that a person or a script could plausibly use. The last two are
// directories that do not exist: a client may connect before anything has created the data
// directory, so the lexical fallback is an ordinary path rather than an error path. Both endpoints
// derive their name from the same directory, so both are asked about the same spellings.
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

// The four outcomes, as the real encoder writes them, plus lines that are not replies. The malformed
// half is where a permissive decoder shows itself: `{"lines":[1]}` renders fine if numbers are
// stringified, and `"extra"` is what an extensible schema would have accepted.
const replyShapes = [
  { outcome: 'chatted', lines: [] },
  { outcome: 'answered', lines: ['桌面没有变化。'] },
  {
    outcome: 'refused',
    lines: ['这个问题我答不了。', '  引号 " 和反斜杠 \\ 和制表符 \t', '  全角　空格 和 emoji 🙂'],
  },
  { outcome: 'failed', lines: ['语言插件在回答时失败：boom'] },
];

const replyLines = [
  ...replyShapes.map((reply) => language.encodeLanguageReply(reply)),
  // The one line the two sides agree about for a reason worth naming: `1.0` is the number 1 in
  // JavaScript, so `!==` says equal. A decoder reading the field as an integer refuses it.
  '{"protocol":1.0,"outcome":"chatted","lines":["a number that is the same number"]}',
  '{"protocol":1,"protocol":1,"outcome":"chatted","lines":["the last of a repeated key wins"]}',
  'not json',
  '',
  'null',
  '[]',
  '[1,2]',
  '"a string"',
  '42',
  '{"protocol":1,"outcome":"chatted"}',
  '{"protocol":1,"outcome":"chatted","lines":["a"],"extra":1}',
  '{"protocol":2,"outcome":"chatted","lines":["a"]}',
  '{"protocol":"1","outcome":"chatted","lines":["a"]}',
  '{"protocol":null,"outcome":"chatted","lines":["a"]}',
  '{"protocol":1,"outcome":"chatting","lines":["a"]}',
  '{"protocol":1,"outcome":null,"lines":["a"]}',
  '{"protocol":1,"outcome":"chatted","lines":"a"}',
  '{"protocol":1,"outcome":"chatted","lines":[1]}',
  '{"protocol":1,"outcome":"chatted","lines":["ok",null]}',
];

// The client's wait bound, and every number it is derived from. `REPLY_TIMEOUT_MS` is read out of
// `cli/ask.js` rather than the language module because it belongs to the client, and a C# client that
// agreed with a *recomputed* number would agree with itself rather than with the thing it is copying.
const longestExposureCount = Math.max(
  language.LANGUAGE_EXPOSURES.length,
  language.LANGUAGE_REPOSITORY_EXPOSURES.length,
);

const timeout = {
  longestExposureCount,
  modelTimeoutMs: language.MODEL_TIMEOUT_MS,
  readAndFramingBudgetMs: ask.READ_AND_FRAMING_BUDGET_MS,
  replyTimeoutMs: ask.REPLY_TIMEOUT_MS,
  maxTextLength: language.MAX_LANGUAGE_TEXT_LENGTH,
  maxRequestLine: language.MAX_LANGUAGE_REQUEST_LINE,
  maxReplyLine: language.MAX_LANGUAGE_REPLY_LINE,
  protocolVersion: language.LANGUAGE_PROTOCOL_VERSION,
};

const stdin = readFileSync(0, 'utf8').trim();
const sent = stdin === '' ? [] : JSON.parse(stdin);

// Two things happen to each request, and they are different claims. The decoder is asked what it makes
// of the line, which is whether the server would answer the question that was asked. The line reader is
// asked whether the line is a *frame* at all, at the bound the server uses — a question that decodes
// perfectly is still never served if it arrives as two lines, and the two failures look nothing alike.
const requests = sent.map(({ text, wire }) => {
  const decoded = language.decodeLanguageRequest(wire);
  const read = new language.LanguageLineReader(language.MAX_LANGUAGE_REQUEST_LINE).push(wire);

  return {
    text,
    nodeWire: language.encodeLanguageRequest({ word: 'ask', text }),
    node:
      decoded.kind === 'request'
        ? { word: decoded.request.word, text: decoded.request.text }
        : null,
    framed: { kind: read.kind, line: read.kind === 'line' ? read.line : null },
  };
});

const replies = replyLines.map((line) => {
  const decoded = language.decodeLanguageReply(line);
  return {
    line,
    node: decoded.kind === 'reply' ? { outcome: decoded.reply.outcome, lines: decoded.reply.lines } : null,
  };
});

process.stdout.write(
  `${JSON.stringify({
    paths: pathInputs.map((input) => ({ input, node: humanDeliveryEndpointPath(input) ?? null })),
    encodes: encodeInputs.map((lines) => ({ lines, wire: encodeDelivery(lines) })),
    decodes: decodeInputs.map((wire) => ({ wire, node: decodeDelivery(wire) ?? null })),
    languagePaths: pathInputs.map((input) => ({ input, node: language.languageEndpointPath(input) ?? null })),
    timeout,
    requests,
    replies,
  })}\n`,
);
