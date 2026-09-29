// `hikari` — the operator console. What is running, what it says, and the two things you can do
// about it.
//
// What this file owns: a terminal, a redraw, a keypress loop, and one detached spawn. What it does
// not own: the resident, its lifetime, or the meaning of anything the resident says.
//
// Three boundaries are worth stating before the code, because each of them is a thing this file is
// most naturally tempted to do:
//
//   * The resident's lifetime is the resident's. This file starts a process and then stops caring:
//     the child is detached and unreferenced, and nothing here waits on it, pipes it or kills it.
//     `control-endpoint.ts` says why in the resident's own words — the resident "decides how long it
//     lives, through its own lease, and a control channel that quietly took that decision over would
//     make the lease a decoration". Quitting this console is not stopping Hikari.
//
//   * The status lines are shown, not read. They are sentences the resident rendered for a human, and
//     there is no promise anywhere that they have a structure — `renderStatus` is explicit that it is
//     "a report of what is already known, not a health check". A console that parsed them into fields
//     would be inventing a schema for a wire that never carried one, and would then be the thing
//     every later change to those sentences had to keep working. So they go to the screen whole, in
//     the order they arrived, and nothing here looks inside them.
//
//   * This is not a second Human Surface. There is no transcript and no way to say anything to
//     Hikari. Talking to Hikari is what the Surface is for and `hikari ask` remains what it was; this
//     screen is for the person who runs the thing, and the two answer different questions.
//
// Zero runtime dependencies, like the rest of this build. Raw mode, an alternate screen buffer and a
// handful of escape sequences are the whole of the terminal work, and a package that wrapped them
// would be the first dependency this repository has.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { requestControl, type ControlOutcome } from './control.js';
import { launchArguments, launchProfilePath, readLaunchProfile, renderLaunchArguments, type LaunchProfile } from './launch-profile.js';
import type { CommandOutcome, ConsoleOptions } from './options.js';

// How often a running resident is asked what it knows. Not a configuration: nothing an operator can
// set here would be anything but a knob on a redraw, and the resident's own cadence — how often it
// looks at the desktop — is the one that belongs to the operator and lives on `resident`'s flags.
const POLL_INTERVAL_MS = 2000;

const ALT_SCREEN_ON = '\x1b[?1049h';
const ALT_SCREEN_OFF = '\x1b[?1049l';
const CURSOR_HIDE = '\x1b[?25l';
const CURSOR_SHOW = '\x1b[?25h';
const CLEAR_SCREEN = '\x1b[2J';
const HOME = '\x1b[H';
const CLEAR_LINE = '\x1b[K';
// Erase from the cursor to the end of the screen. A frame that cleared only to the end of each of
// its own lines would leave whatever the *previous* frame had below its last line, and no two frames
// here are the same length: the status block appears when the resident answers and disappears when it
// stops, the launch note comes and goes with `launching`, a notice adds two lines. The failure is not
// cosmetic. Stopping a resident shortens the frame by the whole status block, so the operator would
// read the stopped resident's plugin lines sitting under the words "没有运行。" — and read them
// indefinitely, because the poll loop redraws that same short frame every two seconds and nothing
// ever clears them. A stale status line shown as current is exactly what §5.3 exists to forbid.
const ERASE_BELOW = '\x1b[J';

/**
 * What the console is currently looking at: a directory it is watching, or the question it asks when
 * it was given none.
 */
export type ConsoleScreen =
  | { readonly kind: 'asking'; readonly typed: string; readonly notice: string }
  | { readonly kind: 'watching'; readonly dataDir: string };

/** What the console currently knows about the resident. `polled` is "has an answer arrived yet". */
export interface ConsoleView {
  readonly answer: ControlOutcome | undefined;
  readonly launching: boolean;
  readonly notice: string;
  readonly polled: boolean;
}

export async function consoleCommand(options: ConsoleOptions): Promise<CommandOutcome> {
  // A console is a terminal or it is nothing. Refusing here rather than drawing escape sequences into
  // a pipe keeps `hikari > file` from producing a page of control codes, and keeps the failure a
  // sentence rather than a corrupt file.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { exitCode: 1, stdout: '', stderr: '操作台需要一个终端；请直接在终端里运行 hikari。\n' };
  }

  return runConsole(options.dataDir);
}

function runConsole(initialDataDir: string | undefined): Promise<CommandOutcome> {
  return new Promise<CommandOutcome>((settle) => {
    let screen: ConsoleScreen =
      initialDataDir === undefined
        ? { kind: 'asking', typed: '', notice: '' }
        : { kind: 'watching', dataDir: initialDataDir };
    let view: ConsoleView = { answer: undefined, launching: false, notice: '', polled: false };
    let polls: NodeJS.Timeout | undefined;
    let polling = false;
    let finished = false;

    const finish = (outcome: CommandOutcome): void => {
      if (finished) return;
      finished = true;
      if (polls !== undefined) clearInterval(polls);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onKey);
      process.stdout.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
      settle(outcome);
    };

    // A last-resort restore, for a death this file did not anticipate — an exception in a key
    // handler, a write to a terminal that has already gone away. It matters more here than in an
    // ordinary CLI: this process owns raw mode and the alternate screen buffer, so a crash that skips
    // `finish` leaves the operator in a shell that echoes nothing until they blindly type `reset`.
    // `exit` fires for an uncaught exception too, and these writes are synchronous, so they land
    // before the process is gone. Nothing is registered before the screen is taken over.
    //
    // Raw mode is part of giving the terminal back, not a detail of the orderly path. On Windows the
    // console restores its own mode per client, but this file does not get to assume the platform will
    // clean up after a crash — the reason `reset` exists is shells that were left in raw mode.
    //
    // The `catch`es are not decoration: the one situation this exists for is a terminal that has
    // already gone away, and that is exactly when these calls can fail. A throw raised from inside an
    // `exit` handler has nowhere left to go, and would turn a recoverable mess into an ugly one.
    process.on('exit', () => {
      if (finished) return;
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Nothing to restore, or nothing left to restore it to.
      }
      try {
        process.stdout.write(`${CURSOR_SHOW}${ALT_SCREEN_OFF}`);
      } catch {
        // The terminal is gone. Nothing this process can still do about it.
      }
    });

    const draw = (): void => {
      process.stdout.write(renderFrame(screen, view));
    };

    // Every asynchronous step goes through here, and it is one rule rather than an error-handling
    // framework: a background step that failed must not take the console down with it. A poll that
    // cannot be made is not a reason to end the session, and the operator keeps a working screen and
    // is told what happened — which is the whole difference between this and a crash.
    const guard = async (work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        if (finished) return;
        view = { ...view, notice: `操作台出了点问题：${error instanceof Error ? error.message : String(error)}` };
        try {
          draw();
        } catch {
          // The terminal itself is gone. There is nothing left to report on, and the `exit` handler
          // above will still try to hand the screen back.
        }
      }
    };

    const refresh = async (): Promise<void> => {
      if (screen.kind !== 'watching' || polling || finished) return;
      polling = true;
      try {
        const answer = await requestControl(screen.dataDir, 'status');
        if (finished) return;
        // A launch in progress stops being one the moment the endpoint answers: that answer is the
        // only evidence this console accepts that the process it started came up, and waiting for
        // anything else — a port, a process table, a guess at how long a bring-up takes — would be
        // this file inventing a second way to know what the resident already says.
        const waiting = view.launching && answer.kind !== 'answered';
        view = { ...view, answer, polled: true, launching: waiting };
        draw();
      } finally {
        // In `finally`, so a throw cannot leave this stuck true and silently stop every later poll.
        polling = false;
      }
    };

    const startPolling = (dataDir: string): void => {
      if (polls !== undefined) clearInterval(polls);
      void guard(refresh);
      polls = setInterval(() => void guard(refresh), POLL_INTERVAL_MS);
    };

    const launch = (): void => {
      if (screen.kind !== 'watching') return;
      const { dataDir } = screen;

      const read = readLaunchProfile(dataDir);
      if (read.kind === 'none') {
        view = { ...view, notice: '这个数据目录还没有启动配置；请先运行 hikari profile set。', launching: false };
        draw();
        return;
      }
      if (read.kind === 'unreadable') {
        view = { ...view, notice: `启动配置无法读取：${read.reason}`, launching: false };
        draw();
        return;
      }

      const args = launchArguments(dataDir, read.profile);
      const failure = spawnDetached(args);
      view = { ...view, notice: failure ?? '', launching: failure === undefined };
      draw();
    };

    const onKey = (chunk: string): void => {
      // Ctrl-C and Ctrl-D are the terminal's, not this screen's: they mean the same thing here that
      // they mean anywhere, and a console that swallowed them would be a process an operator could
      // not interrupt from the keyboard they were already using.
      if (chunk === '\x03' || chunk === '\x04') return finish({ exitCode: 0, stdout: '', stderr: '' });
      if (chunk === '\x1b') return finish({ exitCode: 0, stdout: '', stderr: '' });
      // Arrow and function keys arrive as an escape sequence. Nothing here binds them, and treating
      // their leading escape as "quit" would close the console on an arrow key.
      if (chunk.startsWith('\x1b')) return;

      if (screen.kind === 'asking') return onAskingKey(chunk);

      const action = watchingAction(chunk, view);
      if (action.kind === 'quit') return finish({ exitCode: 0, stdout: '', stderr: '' });
      if (action.kind === 'notice') {
        view = { ...view, notice: action.notice };
        draw();
        return;
      }
      if (action.kind === 'refresh') {
        view = { ...view, notice: '', launching: false };
        void guard(refresh);
        return;
      }
      if (action.kind === 'launch') {
        launch();
        return;
      }
      if (action.kind === 'stop') {
        const { dataDir } = screen;
        void guard(() => stopResident(dataDir));
      }
    };

    const onAskingKey = (chunk: string): void => {
      if (screen.kind !== 'asking') return;

      const { text, submit } = readAskingChunk(chunk);

      if (text) {
        const typed = appendTyped(screen.typed, text);
        if (typed === undefined) {
          // Refused, and said out loud. This screen has exactly one thing to report and a paste it
          // silently ignored is not a report.
          screen = { ...screen, notice: '输入里有控制字符，这一段没有被写进去。' };
          draw();
          return;
        }
        // Typing clears any standing complaint: whatever it was about, the operator has moved on.
        screen = { ...screen, typed, notice: '' };
      }

      if (!submit) {
        if (text) draw();
        return;
      }

      const submitted = screen.typed.trim();
      if (!submitted) {
        screen = { ...screen, notice: '请先给出一个数据目录。' };
        draw();
        return;
      }
      screen = { kind: 'watching', dataDir: submitted };
      view = { answer: undefined, launching: false, notice: '', polled: false };
      startPolling(submitted);
      draw();
    };

    const stopResident = async (dataDir: string): Promise<void> => {
      const answer = await requestControl(dataDir, 'stop');
      if (finished) return;
      view = {
        ...view,
        notice: answer.kind === 'answered' ? '已请求常驻停止。' : describeControlFailure(answer),
        launching: false,
      };
      draw();
      void guard(refresh);
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onKey);
    process.stdout.write(`${ALT_SCREEN_ON}${CURSOR_HIDE}${CLEAR_SCREEN}`);

    if (screen.kind === 'watching') startPolling(screen.dataDir);
    draw();
  });
}

/**
 * What a key means on the watching screen. The key vocabulary is the whole interface an operator has
 * here, so it is stated as a table rather than as branches inside a key handler, where the only way to
 * find out what `[s]` does in a given state is to run the program.
 */
export type ConsoleAction =
  | { readonly kind: 'quit' }
  | { readonly kind: 'ignore' }
  | { readonly kind: 'notice'; readonly notice: string }
  | { readonly kind: 'refresh' }
  | { readonly kind: 'launch' }
  | { readonly kind: 'stop' };

export function watchingAction(key: string, view: ConsoleView): ConsoleAction {
  if (key === 'q') return { kind: 'quit' };
  if (key === 'r') {
    // The operator's own re-read, and the only thing that ends "已发出，正在等它应答". There is no
    // timer on that state on purpose: a launch that failed looks exactly like one that is still
    // coming up, because a resident that dies at bring-up never arms the endpoint (§5.2.1), and how
    // long a successful bring-up takes is not a number this file is entitled to pick. So the person
    // who can see the machine decides when to stop waiting.
    return { kind: 'refresh' };
  }
  if (key === 's') {
    // Four states, and only one of them launches. "Not asked yet" is not "already running" — saying
    // so would be the screen answering a question it had not put to anyone.
    if (view.answer === undefined) return { kind: 'notice', notice: '还没有问过常驻；等这一屏出现状态再按 [s]。' };
    // Without this, a second press starts a second process: the last answer is still `absent`,
    // because the launch has not had time to change it. The resident's own endpoint would refuse the
    // duplicate, but the console's job is not to rely on that for a key held down.
    if (view.launching) {
      return { kind: 'notice', notice: '上一次启动还没有应答。若它已经失败，按 [r] 结束等待，再按 [s]。' };
    }
    if (view.answer.kind !== 'absent') return { kind: 'notice', notice: '常驻已经在运行，或者是控制通道无法访问。' };
    return { kind: 'launch' };
  }
  if (key === 'x') return { kind: 'stop' };
  return { kind: 'ignore' };
}

/**
 * One chunk of input on the asking screen, read as "text, then maybe a terminator".
 *
 * A chunk is not always one key. A pasted path arrives whole, and a path copied out of Explorer
 * carries its own line ending — `D:\data\r`, not `D:\data`. Requiring the chunk to *be* the Enter key
 * misses that; treating the whole chunk as text drops all of it for containing a control character.
 * Both failures are silent, and silence is the one thing the operator cannot act on. So everything
 * before the first line ending is text, and a line ending anywhere in the chunk means submit — which
 * is also what a chunk of `a\nb` should do, entering `a` rather than the path `a` with an invisible
 * newline in it.
 */
export function readAskingChunk(chunk: string): { readonly text: string; readonly submit: boolean } {
  const terminator = chunk.search(/[\r\n]/);
  return terminator === -1
    ? { text: chunk, submit: false }
    : { text: chunk.slice(0, terminator), submit: true };
}

// What a keypress does to the text on the asking screen. Exported and pure for the same reason
// `renderConsole` is: it is the one place this screen decides what counts as input, and a rule about
// input is worth being able to state without owning a terminal.
//
// The rule is "it carries no control character", not "it is ASCII", and the difference is the whole
// reason this is a function. The obvious spelling — printable ASCII, `[\x20-\x7e]` — silently drops
// every character outside it, so on the machine this is built for, typing `D:\项目\hikari` puts
// nothing on the prompt at all: the operator watches an empty line and has no way to tell a rejected
// keystroke from a dead keyboard. Non-ASCII is not the thing being defended against. Control
// characters are, because one hidden inside a data-directory path fails later for a reason nobody
// can see. `Enter`, `Esc` and the backspace keys are answers rather than text and are handled by the
// caller, which is why they do not appear below.
export function appendTyped(typed: string, chunk: string): string | undefined {
  if (chunk === '\x7f' || chunk === '\b') return typed.slice(0, -1);
  return /[\x00-\x1f\x7f]/.test(chunk) ? undefined : typed + chunk;
}

// Detached, unreferenced, and with no pipes. The three go together and each is doing work:
//
//   `detached` puts the child in its own process group, so a signal sent to this console's group does
//   not reach it; `unref` lets this process exit while the child is still running; and `stdio: ignore`
//   is what makes both honest rather than nominal. Keeping a pipe and unref-ing anyway would leave the
//   child writing into a pipe whose reader has exited — an EPIPE it would have to survive, which is a
//   lifetime coupling wearing a different hat.
//
// What is given up is stated rather than hidden: with no pipe, the resident's own bring-up output has
// nowhere to go, so a resident that fails before it can be asked anything reports nothing here. This
// console says that it lost the process rather than inventing a reason. Carrying that text would mean
// a file to write it to, and a log subsystem is the thing this slice was told not to build.
//
// Exported because these three flags are the whole of the "not the owner" claim and the claim is
// measurable: a test can call this and then watch the data directory's endpoint answer. `resident.ts`
// exports its lease constructor for the same reason.
export function spawnDetached(args: readonly string[]): string | undefined {
  const entry = fileURLToPath(new URL('./main.js', import.meta.url));

  try {
    const child = spawn(process.execPath, [entry, ...args], { detached: true, stdio: 'ignore' });
    // The launch is only known to have failed if the spawn itself failed, and that arrives
    // asynchronously. Nothing waits for it: a console that blocked here would be a console that
    // stopped redrawing because a child it does not own was slow to start.
    child.on('error', () => undefined);
    child.unref();
    return undefined;
  } catch (error) {
    return `无法启动常驻：${error instanceof Error ? error.message : String(error)}`;
  }
}

function describeControlFailure(answer: Exclude<ControlOutcome, { readonly kind: 'answered' }>): string {
  return answer.kind === 'absent'
    ? '没有正在运行的 Hikari 常驻。'
    : `无法访问 Hikari 常驻的控制通道：${answer.detail}`;
}

/**
 * One frame, as the bytes that go to the terminal: home, each line cleared to its own end, then the
 * whole tail below the frame erased. Exported and pure for the same reason `renderConsole` is —
 * "a frame leaves nothing of the previous frame behind" is a claim about this function, and it is
 * the half of the redraw that a test could otherwise never reach.
 */
export function renderFrame(screen: ConsoleScreen, view: ConsoleView): string {
  return HOME + renderConsole(screen, view).map((line) => `${line}${CLEAR_LINE}`).join('\n') + ERASE_BELOW;
}

// Exported, and deliberately pure: it takes the state and returns the lines, with no terminal
// anywhere in it. That is what makes §5.3 of the freeze testable — "the resident's lines are shown
// whole and in order" is a claim about this function, and it can be checked without a TTY.
export function renderConsole(screen: ConsoleScreen, view: ConsoleView): readonly string[] {
  if (screen.kind === 'asking') return renderAsking(screen);

  const lines: string[] = [`Hikari 操作台    ${screen.dataDir}`, '', `常驻：${describeResident(screen.dataDir, view)}`];

  // Stated from the moment of launch rather than after some wait, because there is no threshold here
  // that this file is entitled to pick. The situation it describes is already true when the launch is
  // handed off — the console genuinely cannot see the child's output — and it stays true whether the
  // resident comes up in a second or never. Measured, not assumed: a resident that fails at bring-up
  // exits without ever arming the endpoint, so all the poll loop ever sees is `absent`, and the
  // console would otherwise report "没有运行" about something the operator just watched start.
  //
  // The remedy is not invented either. It is the command line already rendered below, run in a
  // terminal instead of detached, which is where that same failure text goes.
  if (view.launching) {
    lines.push(
      '',
      '如果它一直不应答，它多半在启动时就失败了。操作台看不到它的输出——常驻不是它持有的进程。',
      '要看到原因，请在终端里直接运行下面那条等价命令。',
    );
  }

  if (view.answer?.kind === 'answered') {
    lines.push('');
    // Verbatim, in the order the resident sent them, with nothing added and nothing sorted.
    lines.push(...view.answer.lines);
  }

  if (view.notice) {
    lines.push('', view.notice);
  }

  lines.push('', ...renderProfile(screen.dataDir), '', '[s] 启动   [x] 停止   [r] 刷新   [q] 退出');
  return lines;
}

function renderAsking(screen: { readonly typed: string; readonly notice: string }): readonly string[] {
  const lines = [
    'Hikari 操作台',
    '',
    '数据目录：',
    '',
    `  ${screen.typed}_`,
    '',
    '输入一个数据目录后按 Enter；Esc 退出。',
    '没有默认目录，也没有记住的上一次——这里问的就是你在跟哪一个 Hikari 说话。',
  ];
  if (screen.notice) lines.push('', screen.notice);
  return lines;
}

function describeResident(dataDir: string, view: ConsoleView): string {
  if (view.launching) return '已按启动配置发出，正在等它应答…';
  if (!view.polled) return '正在询问…';

  const answer = view.answer;
  if (answer === undefined) return '正在询问…';
  if (answer.kind === 'answered') return answer.outcome === 'ok' ? '正在运行。' : '正在运行，但它报告了失败。';
  if (answer.kind === 'absent') {
    return existsSync(dataDir)
      ? '没有运行。'
      : `没有运行，而且这个数据目录不存在：先运行 hikari init --data-dir <path>。`;
  }
  return `无法访问控制通道：${answer.detail}`;
}

function renderProfile(dataDir: string): readonly string[] {
  const read = readLaunchProfile(dataDir);
  if (read.kind === 'none') return ['启动配置：没有。按 [s] 之前请先运行 hikari profile set。'];
  if (read.kind === 'unreadable') return [`启动配置无法读取：${read.reason}`];

  const profile: LaunchProfile = read.profile;
  return [
    `启动配置：${launchProfilePath(dataDir)}`,
    `  ${renderLaunchArguments(launchArguments(dataDir, profile))}`,
  ];
}
