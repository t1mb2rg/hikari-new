// What this build is willing to understand, as a closed set, and the whole of what the model is
// allowed to say.
//
// This file is the load-bearing part of the slice, and it is load-bearing because of what it is not.
// The model's entire output channel is the four words below: it answers, we look the answer up here,
// and a string that is not one of the four does not become a topic, does not reach a fact, and does
// not reach the human. There is no fifth member and no prose field, so "the model wrote something
// about Hikari that Hikari never established" is not a thing a filter catches — it is a thing that has
// nowhere to travel. `src/desktop-session-observe/presentation.ts` records the measurement that made
// this the design rather than a preference: a surface guarded by a rule about its *content* passed
// every test it had while printing a sentence nobody had established, because a guard over prose is
// satisfied by every sentence that starts the right way. The guard that holds is one where the illegal
// thing cannot be spelled.
//
// `unclassified` is deliberately *not* a member. It is the name of a result — the model answered
// something outside the set, so this build did not understand the question — and a member for it would
// be a topic the model could choose, which would make "I did not understand you" into an answer the
// model is allowed to give about itself. What the model may say is exactly what this build can do;
// what it may not say is a verdict about its own performance.
//
// Four members, and smallness is the point rather than a stage. Each one is a question this build has
// facts to answer with: two of them read the desktop perception chain, one reads the declared work
// focus, and one reads both. A topic is added when a domain has agreed to be read — never because a
// sentence seemed like it ought to be answerable, which is how a closed set turns back into the open
// one it was built to replace.

export type LanguageTopic = 'current-context' | 'work-focus' | 'desktop-state' | 'desktop-change';

/**
 * The closed set, in the order the model is shown it.
 *
 * Written out rather than derived from the glosses below, and the two cannot drift: the gloss table is
 * typed by this union, so a topic with no gloss does not compile and a gloss for no topic does not
 * compile either. What the array adds is an order, and an order is a fact the prompt needs.
 */
export const LANGUAGE_TOPICS: readonly LanguageTopic[] = Object.freeze([
  'current-context',
  'work-focus',
  'desktop-state',
  'desktop-change',
]);

/**
 * What each topic covers, in the words both the model and a human are given.
 *
 * One statement used twice on purpose. The model is shown these to choose between them, and a refusal
 * shows them to a human as the range this build answers — so an operator who asks something out of
 * scope learns the same thing the model was told, rather than a second list that could disagree with
 * it about what Hikari can do.
 */
export const TOPIC_GLOSS: Readonly<Record<LanguageTopic, string>> = Object.freeze({
  'current-context': 'Hikari 现在掌握的整体情况，既包括工作焦点，也包括桌面',
  'work-focus': 'Hikari 当前被明确声明的关注对象',
  'desktop-state': '桌面现在是什么状态：前台窗口、输入活动、当前快照',
  'desktop-change': '桌面相对上一次快照有没有变化',
});
