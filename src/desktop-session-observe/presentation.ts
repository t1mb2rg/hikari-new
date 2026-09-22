// The assessment, said out loud, and nothing else.
//
// This file is the whole of what this slice adds, and what it adds is transcription. Every word it
// writes is a word a contract already said: `available` / `unavailable` and `present` / `absent` are
// the World's own facet and target vocabulary, `changed` / `unchanged` / `indeterminate` and
// `stable` / `baseline` are the Awareness layer's, and every timestamp, source name and input tick is
// a field of the observation that carried it. None of them is translated, summarized or rounded, and
// none of them is added to.
//
// Two vocabularies that look like one, and must not be merged:
//
//   facet     changed | unchanged | indeterminate     `DesktopSessionFacetChange`
//   overall   changed | stable    | indeterminate     `DesktopSessionChange`
//
// `unchanged` and `stable` are different words in the contract — one is a single facet that did not
// move, the other is the whole assessment — and printing either in place of the other would be this
// layer editing a judgement it was only asked to carry. The asymmetry is the contract's, not a
// mistake here, and it survives transcription.
//
// What is deliberately absent is any sentence about what the facts are about. No line says that a
// window title looks like an editor, that input stopped recently, or that a change mattered. The
// question this surface answers is "what does Hikari see?", and the moment it answers "and that
// means…" it has become the interpretation layer it exists to let a human check.
//
// There is no rule in this file and therefore nothing to get wrong: it takes an assessment and
// returns strings. That is why it is exported and tested on every platform rather than only where
// there is a pipe — the same argument `judgement.ts` makes in the relevance plugin, and the same
// reason this repository has already been bitten by a rule pinned only where the pipes are.

import type { DesktopSessionAwarenessAssessment } from '../desktop-session-awareness/index.js';
import { oneLine } from '../terminal-text/index.js';

// The snapshot and its two facets, taken from the assessment's own shape rather than imported from
// the World that produced them. This module's whole type surface therefore comes from the one
// contract it requires, and the claim that it never reaches a World — not even for a type — becomes
// something a test can check by reading this file's imports instead of something a reviewer has to
// take on trust. It is also the honest statement of the boundary: what this layer renders is what the
// assessment carries, not what the World is.
type DesktopSessionWorldSnapshot = DesktopSessionAwarenessAssessment['current'];
type DesktopSessionForegroundFacet = DesktopSessionWorldSnapshot['foreground'];
type DesktopSessionInputActivityFacet = DesktopSessionWorldSnapshot['inputActivity'];

const HEADER = '桌面会话观察：';

// The World's `unavailable` facet carries no reason, on purpose — it does not own the failure
// taxonomy of the sources it composes. Saying so is the faithful transcription: a human who reads
// `unavailable` and no explanation should learn that the contract has none, rather than guess at one
// or wonder what is being withheld.
const UNAVAILABLE_NOTE = '  （这次快照没有该来源的观察；World 的 unavailable facet 不携带原因）';

export function renderAssessment(assessment: DesktopSessionAwarenessAssessment): readonly string[] {
  // `current` rather than a branch per variant: both arms of the union carry the snapshot the
  // assessment is about, so there is one snapshot to render and one place that renders it.
  //
  // Every line goes through `oneLine` on the way out, and doing it here rather than at the one field
  // that needs it today is deliberate: it makes "one element is one line" a property of this return
  // value rather than a hope about its inputs, so a field added later cannot quietly reopen the hole.
  return [
    `${HEADER}${assessment.current.snapshotAt}`,
    ...renderSnapshot(assessment.current),
    ...renderVerdict(assessment),
  ].map(oneLine);
}

function renderSnapshot(snapshot: DesktopSessionWorldSnapshot): readonly string[] {
  return [...renderForeground(snapshot.foreground), ...renderInputActivity(snapshot.inputActivity)];
}

function renderForeground(facet: DesktopSessionForegroundFacet): readonly string[] {
  if (facet.kind === 'unavailable') return ['前台：unavailable', UNAVAILABLE_NOTE];

  const { observation } = facet;
  const lines = [
    '前台：available',
    `  观察时间：${observation.observedAt}`,
    `  来源：${observation.source}`,
  ];

  // `absent` is a window state, not a missing observation: the source looked and reported that no
  // window is in the foreground. It carries no title and no process because there is no window they
  // would be about, which is why the two fields are rendered only for `present`.
  const target = observation.foreground;
  if (target.kind === 'absent') return [...lines, '  当前窗口：absent'];

  return [
    ...lines,
    '  当前窗口：present',
    `  进程名：${renderField(target.processName)}`,
    `  窗口标题：${renderField(target.title)}`,
  ];
}

function renderInputActivity(facet: DesktopSessionInputActivityFacet): readonly string[] {
  if (facet.kind === 'unavailable') return ['输入活动：unavailable', UNAVAILABLE_NOTE];

  const { observation } = facet;
  return [
    '输入活动：available',
    `  观察时间：${observation.observedAt}`,
    `  来源：${observation.source}`,
    // The raw counter, not an elapsed time. `lastInputTick` is what the source reported, and turning
    // it into "3 秒前" would need a second clock reading this layer does not have and a subtraction
    // the contract never asked for.
    `  最后输入 tick：${observation.lastInputTick}`,
  ];
}

// Two ways a field can be missing, and they are different facts the source reported.
//
// An absent key is "the snapshot does not carry this field". A `null` title is the source saying it
// looked and the window has no text — the branch `src/foreground/windows.ts` takes when
// `GetWindowTextW` returns zero for a handle that is still valid.
//
// Collapsing them would tell a human the window has no title when Hikari did not report one, which is
// exactly the kind of claim this surface exists to make checkable.
//
// What neither phrase may do is name a *cause* for the absence. The contract carries the absence and
// nothing else, and the acquisition reaches it by more than one road: `title` is left out when the
// Win32 call throws, but also when it returns zero with `INVALID_WINDOW_HANDLE` — a call that
// completed and found the window gone. Verified by probe, not by reading: `GetWindowTextW` on a
// destroyed handle returns `0` and sets last-error 1400 without throwing. Saying "读取未发生" there
// would be this layer inventing a reason for a read that did happen.
//
// The returned value is escaped by `oneLine` at the end of `renderAssessment` rather than here, so
// that the one-line guarantee covers every field rather than only this one.
function renderField(value: string | null | undefined): string {
  if (value === undefined) return '源未报告（快照里没有这个字段）';
  if (value === null) return '无（源报告为空）';
  return value;
}

function renderVerdict(assessment: DesktopSessionAwarenessAssessment): readonly string[] {
  // A baseline is not an `indeterminate` and must not be spelled as one. `indeterminate` is the
  // Awareness layer saying it compared and could not tell; `baseline` is it saying there was nothing
  // to compare against, which is why it carries no facet changes either.
  if (assessment.kind === 'baseline') {
    return [
      '判词：baseline',
      '  这是该感知链实例的第一次评估：还没有可比对的前一次快照，因此没有 change 判词。',
    ];
  }

  // The comparison partner is named, because a verdict that does not name it is not readable.
  //
  // `stable` is a statement about a pair of snapshots. The header line above gives the second of the
  // two — this assessment is about the snapshot taken at that time — and without the first, a reader
  // has a judgement and no window: `stable` over the last 300ms and `stable` over the last four
  // minutes are the same six characters, and only one of them is worth believing.
  //
  // This is transcription, not an addition. `previous` is carried by the assessment and always has
  // been; `snapshotAt` is a field of the snapshot it carries; nothing here computes, formats or
  // infers anything.
  //
  // It was deliberately withheld once, and the reason it was withheld is the reason it can be shown
  // now. Under a consuming read the partner was an artifact of the reader's own last question — a
  // `stable` from a human's query covered however long it had been since whoever asked last, so the
  // timestamp would have made a wrong window legible without making it right. The surface now reads
  // `peek()`, which does not advance the baseline, so the partner is the one the judgement timeline
  // is standing on and the window is the timeline's own.
  return [
    `判词：${assessment.change}`,
    `  上一次快照：${assessment.previous.snapshotAt}`,
    `  前台相比上一次快照：${assessment.foreground}`,
    `  输入活动相比上一次快照：${assessment.inputActivity}`,
  ];
}
