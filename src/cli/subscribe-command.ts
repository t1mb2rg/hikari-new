// `hikari subscribe` — a human leaving a window open so Hikari can tell them something.
//
// This file writes nothing of its own on the path where a message arrives, and that is the whole
// design, for the same reason `ask-command.ts` gives: the plugin that formed the judgement and the
// component that worded it are the only things that know what was said, so the lines travel to the
// terminal unchanged. Nothing here summarises them, adds a lead-in, prefixes a timestamp, asks whether
// the message was important, or counts them.
//
// What it does add is a line when the stream *ends*, and the reason is that an ending is the one thing
// this client knows and the human does not. A subscription that stops is news: a person who leaves this
// running wants to know when it is no longer running, and a command that exited silently would leave
// them believing Hikari had simply had nothing to say. The line states what could have happened rather
// than picking one, because from this end they are the same observation — see `subscribe.ts`, which is
// where the three endings are defined and where the fourth case (a second subscriber being turned away)
// is folded into `ended` on purpose.
//
// This command does not start, restart or configure a resident, and it has no way to. It carries no
// cadence, no repository and no model: proactive delivery is turned on by the person who started the
// resident, with a flag on `resident`, and a listener that could turn it on would be a second
// composition root. There is nothing here to configure even if someone wanted to.

import { oneLine } from '../terminal-text/index.js';

import type { CliOptions, CommandOutcome } from './options.js';
import { RESIDENT_HINT } from './options.js';
import { subscribeToHumanDelivery, type SubscribeOutcome } from './subscribe.js';

export interface SubscribeIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const PROCESS_IO: SubscribeIo = {
  out: (text) => {
    process.stdout.write(text);
  },
  err: (text) => {
    process.stderr.write(text);
  },
};

export interface SubscribeOverrides {
  readonly io?: SubscribeIo;
}

export async function subscribeCommand(
  options: CliOptions,
  overrides: SubscribeOverrides = {},
): Promise<CommandOutcome> {
  const io = overrides.io ?? PROCESS_IO;

  const outcome = await subscribeToHumanDelivery(options.dataDir, (lines) => {
    // The message, whole, as it was written. One blank line between messages and not between the lines
    // of one: a delivery is a block, and a reader skimming a terminal needs to see where one ends —
    // but a blank line *inside* a block would be this file adding structure to something an owner
    // already laid out.
    io.out(`${lines.join('\n')}\n\n`);
  });

  if (outcome.kind === 'ended') {
    // Exit zero, because an ended subscription is not a failed command. The resident stopping is the
    // ordinary way this ends and a client that exited non-zero for it would make every normal shutdown
    // look like an error to whatever ran this.
    io.err(`${endingLines().join('\n')}\n`);
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  io.err(`${failureLines(outcome).join('\n')}\n`);
  return { exitCode: 1, stdout: '', stderr: '' };
}

// Two words about the process rather than anything about CI, and the restraint is the point: what a
// human configured, which repository it was, and what Hikari has been watching are all facts this
// command never learned. It knows a connection ended.
function endingLines(): readonly string[] {
  return [
    '订阅结束：与 Hikari 的投递连接已关闭。',
    '可能是常驻停止了，已经被重启，或者这个数据目录上已经有另一个订阅者连着。',
  ];
}

// The two conditions are stated rather than the likelier one guessed at, for the reason `askFailureLines`
// gives: from this end they are the same observation, and the remedy for the second is a different
// command line than the remedy for the first.
function failureLines(
  outcome: Exclude<SubscribeOutcome, { readonly kind: 'ended' }>,
): readonly string[] {
  if (outcome.kind === 'absent') {
    return [
      '这个数据目录上没有正在投递的 Hikari 常驻。',
      `若常驻尚未启动，${RESIDENT_HINT}；若它正在启动或停止，请稍后重试。`,
      '主动投递只在常驻启动时给了 --proactive-ci-delay-ms 才会加载。',
    ];
  }

  // Escaped at the interpolation, because this is the one line this file prints that it did not write:
  // `detail` is what a socket error said, or this repository's own words for an unreadable frame. The
  // lines above are fixed words and need nothing.
  return [`无法访问 Hikari 投递入口：${oneLine(outcome.detail)}`];
}
