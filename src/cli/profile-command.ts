// `hikari profile set | show | clear` — the operator writing down how this data directory starts.
//
// The three live in one file for the reason `status` and `stop` do: one subject, three words, and the
// body that reads, writes and removes that subject is the same body. What differs is the verb.
//
// Writing a profile is a separate act from starting a resident, and the separation is the same one
// `--proactive-return-after-ms` keeps: a human configured things about this resident, and remembering
// them is a second decision made in the same place. Nothing here starts anything.
//
// What this file is not allowed to decide is whether a configuration is legal. `set` carries a
// `ResidentOptions` — already read by the resident's own reader, which refuses a half-given pair and
// names the missing half — so a profile can only ever hold something `hikari resident` accepts. Any
// check written here would be a second answer to a question that already has one, and the two would
// eventually disagree about some combination.

import {
  clearLaunchProfile,
  launchArguments,
  launchProfilePath,
  readLaunchProfile,
  renderLaunchArguments,
  writeLaunchProfile,
  type LaunchProfile,
} from './launch-profile.js';
import type { CliOptions, CommandOutcome, ResidentOptions } from './options.js';

export function profileSetCommand(options: ResidentOptions): CommandOutcome {
  const { dataDir, ...profile } = options;
  writeLaunchProfile(dataDir, profile);
  return { exitCode: 0, stdout: renderStored(dataDir, profile), stderr: '' };
}

export function profileShowCommand(options: CliOptions): CommandOutcome {
  const { dataDir } = options;
  const read = readLaunchProfile(dataDir);
  if (read.kind === 'none') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `这个数据目录还没有启动配置：${launchProfilePath(dataDir)}\n请先运行：hikari profile set --data-dir <path> --desktop-awareness-delay-ms <integer>\n`,
    };
  }
  if (read.kind === 'unreadable') {
    return { exitCode: 1, stdout: '', stderr: `启动配置无法读取：${read.reason}\n` };
  }

  return { exitCode: 0, stdout: renderStored(dataDir, read.profile), stderr: '' };
}

// Removing nothing is refused rather than passed over in silence, for the reason a lone
// `--proactive-return-delay-ms` is refused: an operator who typed this believes something was there
// to remove, and a command that agreed with them would be agreeing with a belief it did not check.
export function profileClearCommand(options: CliOptions): CommandOutcome {
  const { dataDir } = options;
  const read = readLaunchProfile(dataDir);
  if (read.kind === 'none') {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `这个数据目录没有启动配置可以清除：${launchProfilePath(dataDir)}\n`,
    };
  }

  // No `RESIDENT_HINT` here, though it is what every other "there is no resident" message ends with.
  // That hint means "start one now", and clearing a profile is not a step towards starting anything —
  // an operator who cleared it did so on purpose, and a resident may well be running at this moment.
  // Appending it would tell them to do a thing they did not ask about, in the vocabulary reserved for
  // the case where the thing is missing.
  clearLaunchProfile(dataDir);
  return {
    exitCode: 0,
    stdout: `已清除启动配置：${launchProfilePath(dataDir)}\n下一次 Hikari 常驻将不再由它决定。\n`,
    stderr: '',
  };
}

// What was stored, said as the command line that would reproduce it. The line is the useful thing to
// show because it is not a description of the profile — it is the profile, in the one spelling both
// the console and the operator use.
function renderStored(dataDir: string, profile: LaunchProfile): string {
  return [
    `启动配置：${launchProfilePath(dataDir)}`,
    `等价命令：${renderLaunchArguments(launchArguments(dataDir, profile))}`,
    '',
  ].join('\n');
}
