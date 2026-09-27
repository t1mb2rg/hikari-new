// One message, on one line, and the rule that says so.
//
// A delivered message is several lines — a header and a handful of fields — and the wire it travels on
// is a byte stream. Writing those lines raw would leave the far end unable to tell a message boundary
// from a blank line inside a message, and unable to tell an empty message from no message at all. So a
// message is framed as one JSON array on one line, which is the same shape every other endpoint in this
// repository uses and for the same reason: JSON is the framing, and the newline is the frame.
//
// It is in this module rather than in the client, and that placement is the point. Both ends of the
// pipe import it, so they agree by construction — a client that wrote its own decoder would be a second
// statement of what this pipe means, and the second one is the copy nobody re-reads when the first
// changes. `src/cli/subscribe.ts` is the client, and it imports this file.
//
// What is deliberately absent: any schema beyond "an array of strings". This transport does not know
// what a line is about, and a decoder that validated content would be this module acquiring exactly
// the understanding its contract refuses.

import { MAX_DELIVERY_MESSAGE_LINE } from './types.js';

/** One message, framed. The trailing newline is the frame, not part of the content. */
export function encodeDelivery(lines: readonly string[]): string {
  return `${JSON.stringify(lines)}\n`;
}

/**
 * One framed message, decoded, or `undefined` if the line was not one.
 *
 * `undefined` rather than a thrown error, and rather than an empty array. A line this build cannot
 * read is not an empty message and must not be rendered as one — a client that printed nothing for it
 * would be reporting that Hikari said nothing, when what happened is that something spoke this
 * protocol wrong. Which of those a client reports is the client's wording; that it can tell them apart
 * is this function's job.
 */
export function decodeDelivery(line: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed)) return undefined;
  if (!parsed.every((entry): entry is string => typeof entry === 'string')) return undefined;

  return parsed;
}

/**
 * Reads a byte stream into framed lines, and refuses to buffer without bound.
 *
 * The bound is the reason this is a class rather than a `split`. A socket hands over whatever happened
 * to arrive, so "one line" is not a property of a chunk and the accumulated partial line is memory the
 * far end chooses the size of. Past `MAX_DELIVERY_MESSAGE_LINE` the read is `overflow` and the caller
 * is expected to end the connection: whoever is on the other end is not speaking this protocol, and
 * answering an unbounded stream with more buffering is answering a conversation that is not happening.
 */
export class DeliveryLineReader {
  readonly #limit: number;
  #buffer = '';

  constructor(limit: number = MAX_DELIVERY_MESSAGE_LINE) {
    this.#limit = limit;
  }

  push(chunk: string): DeliveryLineRead {
    this.#buffer += chunk;

    const newline = this.#buffer.indexOf('\n');
    if (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      if (line.length > this.#limit) return { kind: 'overflow' };
      this.#buffer = this.#buffer.slice(newline + 1);
      return { kind: 'line', line };
    }

    if (this.#buffer.length > this.#limit) return { kind: 'overflow' };
    return { kind: 'pending' };
  }
}

export type DeliveryLineRead =
  | { readonly kind: 'pending' }
  | { readonly kind: 'line'; readonly line: string }
  | { readonly kind: 'overflow' };
