// What the read found, said out loud, and nothing else.
//
// This file is the whole of what a human receives, and what it does is transcription. Every word it
// writes is a word the read already carried: the five kinds, the four viewport relations, the two
// reasons, the three channels and every count are fields of the value it was handed. None of them is
// translated, summarized, rounded or added to.
//
// What is deliberately absent is any sentence about what the content *is*. No line says that a node
// looks like a heading, that the text is a document, that a region is important, or that a window is
// worth reading. The question this surface answers is "what did Hikari read?", and the moment it
// answers "and that means…" it has become the interpretation layer it exists to let a human check.
//
// ---------------------------------------------------------------------------------------------
// Why every line goes through `oneLine`, more insistently here than anywhere
// ---------------------------------------------------------------------------------------------
//
// `src/terminal-text/index.ts` documents the failure it defends against — content impersonating the
// surface that prints it — and it was written for a window *title*. This module renders window *body
// text*: thousands of characters of somebody else's bytes, from an application this repository did not
// write, containing whatever that application put there. The rule binds harder here than where it was
// first needed, so it is applied to the whole returned array rather than to the fields that look risky
// today.
//
// The cost is real and it is named rather than hidden: a paragraph's line breaks arrive as the two
// characters `\n` rather than as line breaks, so a long document reads as one escaped line per node
// rather than as prose. That is the same trade the sibling surface made for the same reason, and it is
// the conservative direction of the trade — the text is still carried verbatim, in order, unsummarized
// and untruncated beyond the bound the read reports; it simply cannot act on the terminal that prints
// it. Making prose out of it again is a rendering decision, and a rendering decision belongs to
// whoever knows what they are reading, not to the surface that reads it out.
//
// There is no rule in this file and therefore nothing to get wrong: it takes a read and returns
// strings. That is why it is exported and tested on every platform rather than only where there is a
// pipe — the same argument `judgement.ts` makes in the relevance plugin, and the same reason this
// repository has already been bitten by a rule pinned only where the pipes are.

import { oneLine } from '../terminal-text/index.js';
import type { ContentRead, ContentReadBounds, Region, WindowIdentity } from './types.js';

const HEADER = '桌面正文读取：';

// The one thing this surface must never be read as claiming, said once per rendering that includes a
// viewport relation — the boundary review §3.7's capability gap, carried outward rather than left in a
// document a human reading a terminal will never open.
//
// It is a limit of the reading, not a disclaimer about it. `viewportRelation` is derived from UIA
// geometry, and geometry is all UIA has: an element that changed only its *rendering* — `Opacity=0`,
// occlusion by a sibling, clipping by a non-scrollable ancestor, GPU compositing — has no UIA property
// that distinguishes it from one that is plainly drawn. It is reported `inside`, and that is wrong in a
// way no amount of care in this module could fix.
//
// §3.7 asks for two things in this text and both are here, because a note that carries half of a gap
// reads as a complete list and the missing half is then the half a human trusts. The first is the
// enumeration above: it is §3.7's four classes, and the fourth — clipping by a non-scrollable ancestor
// — is easy to drop because this walk *does* frame against scrollable ancestors, which makes it look
// covered when it is the non-scrollable case that has no representation at all. The second is the
// sentence about 「可访问 ≠ 可见」: the walk returns the *document*, and groundtruth measured the
// returned set at roughly twice the screen's content, so `inside` on one node is not a claim that the
// human could see it. A consumer that needs visibility has to run its own pass; this surface cannot
// run it for them and must not imply it did.
const GEOMETRY_NOTE =
  '  注：视口关系由 UI Automation 的几何信息推导，不是真实像素可见性。只改变渲染方式、不改变布局的' +
  '隐藏方式（透明度、被其他元素遮挡、被非滚动祖先裁剪、合成层）在 UIA 里没有可区分的属性，会被报告' +
  '为 inside。另外「可访问」不等于「可见」：走查返回的是文档，实测返回集约为屏幕内容的 2 倍，' +
  '要判断真实可见性必须再走一次。';

export function renderContentRead(read: ContentRead): readonly string[] {
  // The window identity first and for every kind, including the three that carry no content. §3.4's
  // third guard: a result says which window it read, so the attribution can be checked from outside
  // rather than taken on this module's word — and it is most worth saying on `refused` and
  // `unreadable`, where the whole answer is about that window.
  const lines = [HEADER, `  结果：${read.kind}`, ...renderWindow(read.window)];

  switch (read.kind) {
    case 'read':
      return [...lines, `  读取时间：${read.readAt}`, ...renderBounds(read.bounds), ...renderRegions(read.regions), GEOMETRY_NOTE].map(oneLine);

    case 'truncated':
      // `truncated` carries its regions, and the note above the regions says which bound stopped the
      // walk. A human needs both: the bound alone says a walk was cut short without saying what it had
      // found before it was, and the regions alone say what was found without saying it is not all of it.
      return [...lines, ...renderBounds(read.bounds), ...renderRegions(read.regions), GEOMETRY_NOTE].map(oneLine);

    case 'empty':
      // No regions and therefore no geometry note. `bounds` is still printed, because "found nothing" is
      // only checkable beside "looked at this many elements".
      return [...lines, `  ${read.note}`, ...renderBounds(read.bounds)].map(oneLine);

    case 'refused':
    case 'unreadable':
      // The note is the read's own sentence about what happened to the window. Nothing is appended to
      // it, and no bound is printed: a walk that did not happen has no counts, and printing zeroes
      // would say it looked and found nothing.
      return [...lines, `  ${read.note}`].map(oneLine);
  }
}

function renderWindow(window: WindowIdentity): readonly string[] {
  return [
    `  窗口句柄：${window.handle}`,
    `  窗口标题：${renderField(window.title)}`,
    `  进程名：${renderField(window.processName)}`,
    // The observation time, not the read time, and labelled so the two are never read as one. Check A
    // of the implementation mandate is the reason they are two facts: the window was seen in front at
    // one moment and read at another, and a human weighing the attribution needs both.
    `  窗口观测时间：${window.observedAt}`,
    `  窗口来源：${window.source}`,
  ];
}

// Three ways a field can be missing, and the sibling surface's argument holds here unchanged: an
// absent field is "the probe did not report it", a `null` is "the probe looked and there was none".
// They are different facts and are never collapsed. The third case exists because the probe's own
// record is what is being typed here and this renderer should not be the place a new absence is
// discovered — an undefined reaching a switch arm is a defect in the read, not a fact about a window,
// and it is shown as one rather than as either of the honest two.
function renderField(value: string | null | undefined): string {
  if (value === undefined) return '未报告（读取结果里没有这个字段）';
  if (value === null) return '无（探针报告为空）';
  // An empty string is a value the probe reported: a window with a caption that is present and empty.
  return value.length === 0 ? '（空字符串）' : value;
}

// The bounds, all seven fields. `scanned` and `matched` are printed beside each other because that
// pair is the one that caught the ground truth's own worst defect — a targeted read that silently
// dropped 32% of a document's body while reporting a healthy match count. A match count alone cannot
// show that; a match count beside a visit count can.
function renderBounds(bounds: ContentReadBounds): readonly string[] {
  return [
    `  访问元素：${bounds.scanned}`,
    `  贡献内容的元素：${bounds.matched}`,
    `  保留字符数：${bounds.textChars}（上限 ${bounds.maxChars}）`,
    `  深度上限：${bounds.maxDepth}　元素数上限：${bounds.maxNodes}`,
    `  截断原因：${renderTruncation(bounds)}`,
  ];
}

// Which bound stopped the walk, in the contract's own words, and — for each — the one thing a human
// needs in order to know what they are not seeing. `null` is not "no truncation happened because
// nothing was there": that is `empty`, and it is a different kind. `null` here means the walk covered
// the window within the three bounds, whatever it then found.
function renderTruncation(bounds: ContentReadBounds): string {
  switch (bounds.truncatedBy) {
    case null:
      return 'null（遍历在三个边界内结束，窗口的这部分已经走完）';
    case 'depth':
      // "The walk stopped", not "the deeper parts are missing", and the difference is the whole reason
      // this line is wordy. `Stop-With` sets a flag that every sibling loop checks, so reaching the
      // depth bound ends the traversal rather than pruning the one branch that reached it. A human told
      // only that the deep elements are missing would not know that elements *shallower* than the bound
      // are missing too, if the walk had not reached them yet when it stopped — which is the ordinary
      // case, because a first branch that goes deep ends the read of everything after it.
      return `depth（到达深度上限 ${bounds.maxDepth}，遍历就此整体停止：不只是更深的分支，停止时尚未访问的元素都没有进入遍历）`;
    case 'nodes':
      return `nodes（访问元素达到上限 ${bounds.maxNodes}，窗口剩下的部分没有进入遍历）`;
    case 'chars':
      return `chars（保留字符达到上限 ${bounds.maxChars}，后面的文本没有保留）`;
  }
}

function renderRegions(regions: readonly Region[]): readonly string[] {
  if (regions.length === 0) return ['  区域：无'];

  const lines: string[] = [`  区域数：${regions.length}`];
  regions.forEach((region, index) => {
    lines.push(`区域 ${index + 1}/${regions.length}：`);
    // The frame is named, because `id` is not unique across regions — grouping is by
    // (frame, relation, reason), so two regions can carry the same id and it is the two lines below
    // that tell them apart. Saying so here is what makes the id checkable rather than decorative.
    lines.push(`  框架：${region.id}`);
    lines.push(`  视口关系：${region.viewportRelation}`);
    lines.push(`  不可见原因：${region.notVisibleBecause ?? 'null'}`);
    lines.push(`  节点（${region.nodes.length}）：`);
    for (const node of region.nodes) {
      // The channel travels with every node, and it is not a content judgement: the ground truth
      // measured `Name` carrying body text on WPF and accessibility labels on the same window, with no
      // property distinguishing the two. A human deciding what a string is needs to know where it came
      // from, and only they can decide the rest.
      lines.push(`    [${node.channel} d${node.depth}] ${node.text}`);
    }
  });
  return lines;
}
