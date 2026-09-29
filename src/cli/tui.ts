// `hikari` — the TUI. One window on a running Hikari: what it is doing, what it just said, what it
// said to you on its own, and the four things you can do about it.
//
// What this file owns: a terminal, a redraw, a keypress loop, one detached spawn, and the wiring that
// lets three existing clients run beside each other. What it does not own: the resident, its lifetime,
// the meaning of anything the resident says, the language plugin's opinions, or the delivery endpoint's
// policy about who is listening.
//
// This file is the *only* place the four clients meet, and that is the whole of the architecture claim.
// The mandate's §1 says the unification is of the UI and not of the protocol, so the test it has to pass
// is whether anything here could be lifted out and served to a second surface. Nothing can: every line
// below either drives a terminal or hands a sentence to a function that already existed, and the four
// calls it makes — `requestControl`, `requestLanguageAsk`, `subscribeToHumanDelivery`,
// `readLaunchProfile` — are the same four calls `control-command.ts`, `ask-command.ts`,
// `subscribe-command.ts` and the v0 console already made. There is no router, no shared message type,
// no second vocabulary, and no state object that outlives the process.
//
// Three boundaries carried over from the v0 console, each of them a thing this file is most naturally
// tempted to do:
//
//   * The resident's lifetime is the resident's. This file starts a process and stops caring: the child
//     is detached and unreferenced, and nothing waits on it, pipes it or kills it except through the
//     resident's own `stop` word. Quitting this TUI is not stopping Hikari, and there is no key here
//     that both leaves the screen and ends a process.
//
//   * The status lines are shown, not read. They are sentences the resident rendered for a human, and
//     §6 forbids recovering structure from them. So they go to the screen whole, in the order they
//     arrived, and nothing in this file or the renderer looks inside them — `ControlOutcomeView.lines`
//     is a list of opaque strings with no fields to read even if someone wanted to.
//
//   * One ask at a time, and it blocks nothing else. The three asynchronous lines — the status poll, the
//     question in flight, the delivery subscription — are started independently and never joined. A
//     question that takes ninety seconds does not stop the resident's status being refreshed, does not
//     stop Hikari finding the human, and does not stop the human from typing `/stop`.
//
// Zero runtime dependencies, like the rest of this build.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { oneLine } from '../terminal-text/index.js';
import { askFailureLines, requestLanguageAsk } from './ask.js';
import { requestControl, type ControlOutcome } from './control.js';
import {
  launchArguments,
  launchProfilePath,
  readLaunchProfile,
  type LaunchProfile,
} from './launch-profile.js';
import type { CommandOutcome, TuiOptions } from './options.js';
import { subscribeToHumanDelivery } from './subscribe.js';
import {
  EMPTY_EDIT,
  editLine,
  isInterrupt,
  readTuiKey,
  type LineEdit,
  type SlashCommand,
} from './tui-input.js';
import {
  ENTER_SCREEN,
  LEAVE_SCREEN,
  bodyRows,
  renderAskFrame,
  renderFrame,
  type TuiRenderOptions,
} from './tui-render.js';
import {
  MEMORY_MARKER,
  afterClear,
  appendEntry,
  decideSubmit,
  initialState,
  memoryMarkerNeeded,
  nextView,
  toneOfReplied,
  type ControlOutcomeView,
  type ProfileField,
  type ProfileView,
  type TuiState,
  type TuiViewName,
} from './tui-state.js';

// How often a running resident is asked what it knows. Not a configuration: nothing an operator could
// set here would be anything but a knob on a redraw.
const POLL_INTERVAL_MS = 2000;

// The retry cadence for the delivery subscription, and it is a *bounded backoff* rather than a loop.
// §8 allows reconnecting and forbids spinning, and the difference is exactly this: a resident that is
// not running resolves the subscription immediately with `absent`, so an unthrottled retry would be a
// busy loop against the filesystem for as long as the window stayed open. `ended` resets the count,
// because a connection that closed is evidence the endpoint exists and the next attempt is a first
// attempt rather than a fifth.
const DELIVERY_RETRY_MS = 2000;
const DELIVERY_RETRY_MAX_MS = 30_000;

// How long a restart waits for the old resident to let go of its endpoints. This is a bound on a wait
// rather than a guess at how long a shutdown takes: the loop below polls the resident's own control
// channel, so a resident that goes away in 200ms is not waited on for fifteen seconds.
const RESTART_WAIT_MS = 15_000;
const RESTART_POLL_MS = 250;

export async function tuiCommand(options: TuiOptions): Promise<CommandOutcome> {
  // A TUI is a terminal or it is nothing. Refusing here rather than drawing escape sequences into a pipe
  // keeps `hikari > file` from producing a page of control codes, and keeps the failure a sentence
  // rather than a corrupt file.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return { exitCode: 1, stdout: '', stderr: 'Hikari 需要一个终端；请直接在终端里运行 hikari。\n' };
  }

  return runTui(options.dataDir);
}

function runTui(initialDataDir: string | undefined): Promise<CommandOutcome> {
  return new Promise<CommandOutcome>((settle) => {
    // Before a data directory is chosen there is no state to hold, only the prompt. `undefined` here is
    // the whole of what distinguishes the two phases.
    let state: TuiState | undefined =
      initialDataDir === undefined ? undefined : initialState(initialDataDir);
    let ask: LineEdit = EMPTY_EDIT;
    let askNotice = '';
    let polls: NodeJS.Timeout | undefined;
    let deliveryTimer: NodeJS.Timeout | undefined;
    let deliveryAttempts = 0;
    let polling = false;
    let finished = false;
    // Whether the last control answer said something is running. The transition into it is what a
    // restart looks like from here, and §7's marker hangs off that transition.
    let sawRunning = false;

    const renderOptions = (): TuiRenderOptions => {
      // Read per frame rather than once, which is what makes a resize need no state at all: the next
      // frame is simply drawn for the window that exists now, and a human who resizes keeps their
      // transcript, their half-typed sentence and their question in flight because none of the three was
      // ever derived from the window's size.
      //
      // `NO_COLOR` is the usual convention for a terminal someone has asked not to be coloured, and the
      // convention is "present and not empty": `NO_COLOR= hikari` in a shell that exports every
      // assignment is not a statement about colour, and reading it as one would take colour away on the
      // strength of an empty string.
      const noColor = process.env.NO_COLOR;
      return {
        columns: process.stdout.columns ?? 80,
        rows: process.stdout.rows ?? 24,
        color: noColor === undefined || noColor === '',
      };
    };

    const draw = (): void => {
      const render = renderOptions();
      process.stdout.write(
        state === undefined ? renderAskFrame(ask, askNotice, render) : renderFrame(state, render),
      );
    };

    const finish = (outcome: CommandOutcome): void => {
      if (finished) return;
      finished = true;
      if (polls !== undefined) clearInterval(polls);
      if (deliveryTimer !== undefined) clearTimeout(deliveryTimer);
      process.stdout.removeListener('resize', draw);
      // `setRawMode` is the one call in this sequence that can throw, and the situation it throws in is
      // the situation the handler below was written for: a console that has already gone away. Letting
      // it take the rest of the sequence with it is the failure that matters, because `finished` was set
      // above — so the last-resort handler stands down, `LEAVE_SCREEN` is never written, and the human is
      // left in the alternate screen with raw mode still on, which is exactly the mess that handler
      // exists to prevent. The handle is dead either way, so nothing is lost by carrying on.
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Nothing left to put back into line mode. The screen is still this function's to hand over.
      }
      process.stdin.pause();
      process.stdin.off('data', onKey);
      process.stdout.write(LEAVE_SCREEN);
      settle(outcome);
      // The delivery subscription holds an open socket, and an open socket is an *active handle*: it
      // keeps the event loop alive on its own. `subscribe.ts` is explicit that its subscription is not
      // cancellable from the client and that the way a human stops listening is the way they stop any
      // foreground process — so the release §8 describes is this line. Without it the process would
      // outlive its own screen, invisible, until the resident happened to stop.
      //
      // Nothing is lost by exiting here rather than returning: the TUI's outcome carries empty strings,
      // because everything it had to say it already wrote to the terminal. The `exit` handler below is
      // guarded by `finished`, so it will not try to hand the screen back twice.
      process.exit(outcome.exitCode);
    };

    // A last-resort restore, for a death this file did not anticipate — an exception inside a key
    // handler, a write to a terminal that has already gone away. It matters more here than in an
    // ordinary CLI: this process owns raw mode and the alternate screen buffer, so a crash that skips
    // `finish` leaves the human in a shell that echoes nothing until they blindly type `reset`.
    //
    // The `catch`es are not decoration. The one situation this exists for is a terminal that has already
    // gone away, and that is exactly when these calls can fail; a throw raised from inside an `exit`
    // handler has nowhere left to go, and would turn a recoverable mess into an ugly one.
    process.on('exit', () => {
      if (finished) return;
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Nothing to restore, or nothing left to restore it to.
      }
      try {
        process.stdout.write(LEAVE_SCREEN);
      } catch {
        // The terminal is gone. Nothing this process can still do about it.
      }
    });

    // Every asynchronous step goes through here, and it is one rule rather than an error-handling
    // framework: a background step that failed must not take the screen down with it. A poll that cannot
    // be made is not a reason to end the session — the human keeps a working window and is told what
    // happened, which is the whole difference between this and a crash.
    const guard = async (work: () => Promise<void>): Promise<void> => {
      try {
        await work();
      } catch (error) {
        if (finished) return;
        pushNotice(`出了点问题：${error instanceof Error ? error.message : String(error)}`);
      }
    };

    // ---------------------------------------------------------------------------------------
    // The transcript
    // ---------------------------------------------------------------------------------------

    const stamp = (): string => {
      const now = new Date();
      const pad = (value: number): string => String(value).padStart(2, '0');
      return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    /** Add a line of this program's own — never one of Hikari's, and never presented as one. */
    const pushNotice = (text: string): void => {
      if (state === undefined || finished) return;
      state = { ...state, transcript: appendEntry(state.transcript, { kind: 'notice', at: stamp(), text }) };
      draw();
    };

    // ---------------------------------------------------------------------------------------
    // The control channel: status on a loop, and the two words this screen may say
    // ---------------------------------------------------------------------------------------

    const controlView = (answer: ControlOutcome): ControlOutcomeView => {
      if (answer.kind === 'answered') return answer;
      return answer.kind === 'absent' ? { kind: 'absent' } : { kind: 'unreachable', detail: answer.detail };
    };

    const refresh = async (): Promise<void> => {
      if (state === undefined || polling || finished) return;
      const { dataDir } = state;
      polling = true;
      try {
        const answer = await requestControl(dataDir, 'status');
        if (finished || state === undefined) return;

        // A launch in progress stops being one the moment the endpoint answers: that answer is the only
        // evidence this screen accepts that the process it started came up, and waiting for anything
        // else — a port, a process table, a guess at how long a bring-up takes — would be this file
        // inventing a second way to know what the resident already says.
        const waiting = state.launching && answer.kind !== 'answered';
        const running = answer.kind === 'answered';

        // §7's one visible sentence, and it is emitted on the transition into "something is running"
        // rather than on every poll. That transition is exactly a restart — from this screen's point of
        // view — so the window above it is content that survived one, and the human is about to read it
        // as a conversation Hikari is still in.
        const marker = running && !sawRunning && memoryMarkerNeeded(state.transcript, true);

        state = {
          ...state,
          control: controlView(answer),
          launching: waiting,
          transcript: marker
            ? appendEntry(state.transcript, { kind: 'notice', at: stamp(), text: MEMORY_MARKER })
            : state.transcript,
        };
        sawRunning = running;
        draw();
      } finally {
        // In `finally`, so a throw cannot leave this stuck true and silently stop every later poll.
        polling = false;
      }
    };

    const startPolling = (): void => {
      if (polls !== undefined) clearInterval(polls);
      void guard(refresh);
      polls = setInterval(() => void guard(refresh), POLL_INTERVAL_MS);
    };

    // ---------------------------------------------------------------------------------------
    // Starting, stopping, restarting
    // ---------------------------------------------------------------------------------------

    const launch = (): void => {
      if (state === undefined) return;
      const { dataDir } = state;

      const read = readLaunchProfile(dataDir);
      if (read.kind === 'none') {
        state = { ...state, launching: false };
        pushNotice('这个数据目录还没有启动配置；请先运行 hikari profile set。');
        return;
      }
      if (read.kind === 'unreadable') {
        state = { ...state, launching: false };
        pushNotice(`启动配置无法读取：${oneLine(read.reason)}`);
        return;
      }

      const failure = spawnDetached(launchArguments(dataDir, read.profile));
      state = { ...state, launching: failure === undefined };
      if (failure !== undefined) pushNotice(failure);
      else draw();
    };

    const stop = async (): Promise<void> => {
      if (state === undefined) return;
      const { dataDir } = state;
      const answer = await requestControl(dataDir, 'stop');
      if (finished || state === undefined) return;
      state = {
        ...state,
        launching: false,
      };
      if (answer.kind === 'answered') pushNotice('已请求常驻停止。');
      else pushNotice(answer.kind === 'absent' ? '没有正在运行的 Hikari 常驻。' : `无法访问 Hikari 常驻的控制通道：${oneLine(answer.detail)}`);
      void guard(refresh);
    };

    /**
     * Stop, wait for the resident to actually be gone, then start.
     *
     * The wait is the part worth justifying, because a `stop` followed immediately by a launch is the
     * obvious implementation and it does not work. The new resident arms the same two named pipes the old
     * one holds, and on Windows a second listener on a name that is still open fails — so an immediate
     * restart produces a process that dies at bring-up, detached and pipeless, with the old resident
     * still running or just gone. The human would have asked for a restart and got a stop.
     *
     * So this waits, and it waits on evidence rather than on a duration: it asks the resident's own
     * control channel until that channel says nothing is there. An operator who would rather not wait can
     * press Ctrl+Q and run `hikari start` themselves, which is what the notice says if the wait expires.
     */
    const restart = async (): Promise<void> => {
      if (state === undefined) return;
      const { dataDir } = state;
      // The gate is held across the whole sequence, and it is a field of its own rather than `launching`
      // because those two say different things — see the note on `TuiState.restarting`.
      //
      // What it is for: this sequence awaits twice, and the wait is the part that matters. A second
      // `/restart` typed inside those fifteen seconds runs a second sequence beside the first; both ask
      // the same resident to stop, both watch it leave, and both reach `launch()` — two detached
      // residents in one data directory, invisible and unstoppable from this screen, which is the one
      // conflict the `/start` path above reads a fresh status specifically to avoid.
      //
      // `finally` because there are four ways out of the sequence — the wait expires, the window closes,
      // a request throws, or the launch runs — and an entry that left the gate held would refuse every
      // later restart for the rest of the session.
      state = { ...state, restarting: true };
      try {
        pushNotice('正在停止常驻，等它退出后再启动…');
        await requestControl(dataDir, 'stop');

        const deadline = Date.now() + RESTART_WAIT_MS;
        let gone = false;
        while (!finished && Date.now() < deadline) {
          const answer = await requestControl(dataDir, 'status');
          if (answer.kind === 'absent') {
            gone = true;
            break;
          }
          await delay(RESTART_POLL_MS);
        }
        if (finished || state === undefined) return;

        if (!gone) {
          state = { ...state, launching: false };
          pushNotice(`${RESTART_WAIT_MS / 1000} 秒内没有等到常驻退出，所以没有重新启动它。`);
          return;
        }
        launch();
      } finally {
        if (state !== undefined && !finished) state = { ...state, restarting: false };
      }
    };

    // ---------------------------------------------------------------------------------------
    // The delivery subscription: Hikari finding the human
    // ---------------------------------------------------------------------------------------

    /**
     * Open the subscription, and reopen it — slowly — whenever it ends.
     *
     * §8 permits a bounded reconnect and forbids spinning, and the bound matters because of the ordinary
     * case rather than the exotic one: with no resident running, this resolves immediately with `absent`,
     * so a loop without a delay would be a filesystem poll running as fast as the machine allows for as
     * long as the window stayed open.
     *
     * The TUI does not compete for the endpoint. `human-delivery` serves one subscriber, and §15 says
     * that stays true this round: if the Human Surface or `hikari subscribe` already holds it, this
     * subscription ends, the header says so, and Chat and System carry on working. Nothing here kicks,
     * steals or asks the server to fan out.
     */
    const listen = (): void => {
      if (finished || state === undefined) return;
      const { dataDir } = state;

      void subscribeToHumanDelivery(dataDir, (lines) => {
        if (finished || state === undefined) return;
        // Verbatim. The only thing added is which of the three kinds of entry this is and when it
        // arrived, which is chrome the mandate names explicitly; the lines themselves are not joined,
        // trimmed, filtered, reordered or coloured by this file.
        //
        // The scroll position is deliberately left alone. A message arriving is not the human acting, and
        // yanking a window they had scrolled back to read would be this screen deciding it knows better
        // where they were looking.
        state = {
          ...state,
          transcript: appendEntry(state.transcript, { kind: 'proactive', at: stamp(), lines }),
        };
        draw();
      })
        .then((outcome) => {
          if (finished || state === undefined) return;
          const tone = outcome.kind === 'ended' ? 'ended' : outcome.kind === 'absent' ? 'absent' : 'unreachable';
          state = {
            ...state,
            delivery: {
              kind: 'stopped',
              tone,
              detail: outcome.kind === 'unavailable' ? outcome.detail : '',
            },
          };
          draw();

          // `ended` is the one ending that is evidence the endpoint exists — the connection was up and
          // then it was not — so the next attempt is a first attempt rather than a fifth, and the wait
          // goes back to its floor. `absent` and `unreachable` are the endings with nothing serving,
          // and those are the ones that back off.
          if (tone === 'ended') deliveryAttempts = 0;
          const wait = Math.min(DELIVERY_RETRY_MAX_MS, DELIVERY_RETRY_MS * 2 ** deliveryAttempts);
          deliveryAttempts += 1;
          deliveryTimer = setTimeout(listen, wait);
        })
        .catch((error: unknown) => {
          if (finished || state === undefined) return;
          pushNotice(`主动投递出了问题：${error instanceof Error ? error.message : String(error)}`);
        });
    };

    // ---------------------------------------------------------------------------------------
    // Views and the profile
    // ---------------------------------------------------------------------------------------

    const setView = (view: TuiViewName): void => {
      if (state === undefined) return;
      state = { ...state, view };
      if (view === 'profile') state = { ...state, profile: readProfileView(state.dataDir) };
      if (view === 'system') void guard(refresh);
      draw();
    };

    // ---------------------------------------------------------------------------------------
    // Keys
    // ---------------------------------------------------------------------------------------

    const submit = (line: string, dropped: boolean): void => {
      if (state === undefined) return;
      const decision = decideSubmit(state, line);
      if (decision.kind === 'empty') return;

      if (decision.kind === 'busy') {
        pushNotice('上一个问题还没有回答完；等它回来再问，或者用 /stop、/status 这类命令。');
        return;
      }
      if (decision.kind === 'refused') {
        pushNotice(decision.reason);
        return;
      }

      // The human just acted, so the window goes back to the live bottom. Nothing else moves it: a reply
      // arriving ninety seconds later, or a message Hikari decided to send, leaves the scroll where the
      // human left it.
      state = { ...state, scroll: 0 };

      if (decision.kind === 'command') {
        if (dropped) pushNotice('粘贴的内容里有换行，只发出了第一行。');
        runCommand(decision.command.kind);
        return;
      }

      const { dataDir } = state;
      state = {
        ...state,
        asking: true,
        transcript: appendEntry(state.transcript, { kind: 'human', at: stamp(), text: decision.text }),
      };
      if (dropped) pushNotice('粘贴的内容里有换行，只发出了第一行。');
      draw();

      void guard(async () => {
        const answer = await requestLanguageAsk(dataDir, decision.text);
        if (finished || state === undefined) return;
        state = {
          ...state,
          asking: false,
          transcript: appendEntry(
            state.transcript,
            answer.kind === 'replied'
              ? { kind: 'reply', at: stamp(), tone: toneOfReplied(answer.reply), lines: answer.reply.lines }
              : {
                  kind: 'reply',
                  at: stamp(),
                  tone: answer.kind === 'absent' ? 'absent' : 'unreachable',
                  // The client's own words for these two states, reused rather than rewritten. `absent`
                  // covers both "no resident" and "a resident with no model configured", and `ask.ts`
                  // says both rather than guessing between them — a second copy of that sentence here
                  // would be a second answer to a question that already has one.
                  lines: askFailureLines(answer),
                },
          ),
        };
        draw();
      });
    };

    const runCommand = (kind: SlashCommand['kind']): void => {
      if (state === undefined) return;
      if (kind === 'quit') return finish({ exitCode: 0, stdout: '', stderr: '' });
      if (kind === 'clear') {
        // The TUI's own window and nothing else. §5.4: not the dialogue context, which belongs to the
        // resident's language plugin; not the chronicle; not memory. This is a screen forgetting, and a
        // screen is all it is — which is the whole content of `afterClear`, and the reason the rule is a
        // function in the pure module rather than two lines here.
        state = afterClear(state);
        pushNotice('这个窗口清空了。Hikari 那边没有变。');
        return;
      }
      if (kind === 'help') {
        pushNotice(
          [
            '/help 显示这份列表',
            '/clear 清空这个窗口（不影响 Hikari 记住的东西）',
            '/status 切到 System 并刷新常驻状态',
            '/start 按启动配置启动常驻',
            '/stop 请求常驻停止',
            '/restart 停止常驻，等它退出后重新启动',
            '/profile 切到 Profile，显示这个数据目录记住的启动配置',
            '/quit 退出（不停止常驻）',
            'Tab 切换视图，PgUp/PgDn 翻看对话，Ctrl+Q 退出。',
            '其他任何文字都会原样交给 Hikari。',
          ].join('\n'),
        );
        return;
      }
      if (kind === 'status') return setView('system');
      if (kind === 'profile') return setView('profile');
      if (kind === 'start') {
        // Asked fresh rather than read off the last poll. The poll is up to two seconds old and the
        // state it would answer from is `undefined` until the first one lands, so a `/start` typed the
        // moment the window opens could otherwise start a second resident beside one already running —
        // and two residents in one data directory is the one conflict this screen must not manufacture.
        const { dataDir } = state;
        void guard(async () => {
          const answer = await requestControl(dataDir, 'status');
          if (finished || state === undefined) return;
          if (answer.kind === 'answered') {
            pushNotice('常驻已经在运行，没有重复启动。');
            return;
          }
          if (answer.kind === 'unavailable') {
            pushNotice(`控制通道无法访问，没有启动：${oneLine(answer.detail)}`);
            return;
          }
          launch();
        });
        return;
      }
      if (kind === 'stop') {
        void guard(stop);
        return;
      }
      if (kind === 'restart') {
        if (state.launching) {
          pushNotice('上一次启动还没有应答；等它出现状态之后再重启。');
          return;
        }
        if (state.restarting) {
          pushNotice('已经有一个重启没有走完，等它结束。');
          return;
        }
        void guard(restart);
      }
    };

    const onKey = (chunk: string): void => {
      // Ctrl+C and Ctrl+D are the terminal's, not this screen's: they mean the same thing here that they
      // mean anywhere, and a TUI that swallowed them would be a process a human could not interrupt from
      // the keyboard they were already using. Neither of them stops the resident.
      if (isInterrupt(chunk)) return finish({ exitCode: 0, stdout: '', stderr: '' });

      if (state === undefined) {
        // Esc leaves the prompt. It is bound here and not in the TUI proper, where it is the first byte of
        // every arrow key and binding it would close the window on a cursor movement.
        if (chunk === '\x1b') return finish({ exitCode: 0, stdout: '', stderr: '' });
        const result = editLine(ask, chunk);
        if (result.kind === 'ignored') return;
        if (result.kind === 'refused') {
          askNotice = result.reason;
          draw();
          return;
        }
        if (result.kind === 'editing') {
          ask = result.edit;
          askNotice = '';
          draw();
          return;
        }
        const submitted = result.text.trim();
        if (submitted === '') {
          askNotice = '请先给出一个数据目录。';
          draw();
          return;
        }
        state = initialState(submitted);
        ask = EMPTY_EDIT;
        askNotice = '';
        startPolling();
        listen();
        draw();
        return;
      }

      const key = readTuiKey(chunk);
      if (key === 'quit') return finish({ exitCode: 0, stdout: '', stderr: '' });
      if (key === 'next-view') return setView(nextView(state.view));
      if (key === 'scroll-up' || key === 'scroll-down') {
        // A page is what the window can actually show, taken from the renderer rather than guessed: the
        // chrome above and below the body is the renderer's business, and a second copy of that number
        // here is a second copy that goes stale the next time a header line is added.
        const page = bodyRows(renderOptions());
        const step = key === 'scroll-up' ? page : -page;
        state = { ...state, scroll: Math.max(0, state.scroll + step) };
        draw();
        return;
      }

      const result = editLine(state.edit, chunk);
      if (result.kind === 'ignored') return;
      if (result.kind === 'refused') {
        pushNotice(result.reason);
        return;
      }
      if (result.kind === 'editing') {
        state = { ...state, edit: result.edit };
        draw();
        return;
      }
      state = { ...state, edit: EMPTY_EDIT };
      submit(result.text, result.dropped);
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', onKey);
    process.stdout.on('resize', draw);
    process.stdout.write(ENTER_SCREEN);

    if (state !== undefined) {
      startPolling();
      listen();
    }
    draw();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Detached, unreferenced, and with no pipes. The three go together and each is doing work:
 *
 *   `detached` puts the child in its own process group, so a signal sent to this TUI's group does not
 *   reach it; `unref` lets this process exit while the child is still running; and `stdio: ignore` is
 *   what makes both honest rather than nominal. Keeping a pipe and unref-ing anyway would leave the
 *   child writing into a pipe whose reader has exited — an EPIPE it would have to survive, which is a
 *   lifetime coupling wearing a different hat.
 *
 * What is given up is stated rather than hidden: with no pipe, the resident's own bring-up output has
 * nowhere to go, so a resident that fails before it can be asked anything reports nothing here. This
 * screen says it lost the process rather than inventing a reason. Carrying that text would mean a file
 * to write it to, and a log subsystem is the thing this slice was told not to build.
 */
export function spawnDetached(args: readonly string[]): string | undefined {
  const entry = fileURLToPath(new URL('./main.js', import.meta.url));

  try {
    const child = spawn(process.execPath, [entry, ...args], { detached: true, stdio: 'ignore' });
    // The launch is only known to have failed if the spawn itself failed, and that arrives
    // asynchronously. Nothing waits for it: a screen that blocked here would be one that stopped
    // redrawing because a child it does not own was slow to start.
    child.on('error', () => undefined);
    child.unref();
    return undefined;
  } catch (error) {
    return `无法启动常驻：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * The Launch Profile as the Profile view shows it.
 *
 * Every field is read off the typed profile that `readLaunchProfile` returned. Nothing here looks at
 * `renderLaunchArguments`, and that restraint is the whole point of the function existing separately:
 * the equivalent command line is a string, and recovering "which model" from it would be parsing, which
 * is the thing §7 forbids. Going the other way — from the object to the display — cannot drift, because
 * a field that is renamed stops compiling.
 *
 * The credential is shown as the *name of the environment variable* and never as a value. This file could
 * not print the value if it wanted to: the process that holds it reads it at bring-up, in another
 * process, and nothing on this side ever sees it.
 */
export function readProfileView(dataDir: string): ProfileView {
  const read = readLaunchProfile(dataDir);
  if (read.kind === 'none') return { kind: 'none' };
  if (read.kind === 'unreadable') return { kind: 'unreadable', reason: read.reason };

  const profile: LaunchProfile = read.profile;
  const fields: ProfileField[] = [
    { label: 'desktop-awareness 延迟', value: `${profile.desktopAwarenessDelayMs} ms`, set: true },
    field('模型入口', profile.model?.endpoint),
    field('模型', profile.model?.model),
    field('推理强度', profile.model?.reasoningEffort),
    field('凭据环境变量', profile.model?.credentialEnv),
    field('仓库根目录', profile.repositoryCi?.rootDir),
    field('仓库', profile.repositoryCi?.repository),
    field('proactive CI 延迟', optionalMs(profile.proactiveCiDelayMs)),
    field('proactive 回归延迟', optionalMs(profile.proactiveReturn?.delayMs)),
    field('proactive 回归窗口', optionalMs(profile.proactiveReturn?.afterMs)),
  ];
  return { kind: 'profile', path: launchProfilePath(dataDir), fields };
}

function field(label: string, value: string | undefined): ProfileField {
  return value === undefined ? { label, value: '', set: false } : { label, value, set: true };
}

function optionalMs(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value} ms`;
}
