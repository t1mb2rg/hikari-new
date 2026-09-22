// Understand: one sentence in, one word out, and the word is looked up in a closed set.
//
// This is the only place the model is used, and the only thing it is used for. It does not write the
// answer, it does not summarize a fact, it does not decide whether something is important, and it is
// never shown a fact to have an opinion about — it is shown the human's sentence and the four names,
// and it picks one. Everything after this file is deterministic code reading contracts and rendering
// what they reported.
//
// That is a v1 staging decision and it is worth saying so rather than dressing it up as a principle:
// a later round may well want the model to do more. What will not change is the property this file
// gives — the model's output reaches the human only by first becoming a member of `LanguageTopic`, so
// there is no sentence the model can write that a human reads as Hikari's finding. Widening what the
// model does means widening that lookup, in this file, on purpose, and not by adding a channel
// somewhere else that nobody notices.
//
// The previous turn, when there is a usable one, is offered as context and is the whole of what
// follow-up resolution is. The model is told what the last accepted question was understood as and
// told that a sentence naming no new subject is about that; it then answers with one of the four
// names, like any other turn. There is no reference-resolution framework, no pronoun table and no
// anaphora pass, because the question "what does 刚才 mean" is a question about language, and asking
// the model that is what the model is here for.

import type { DialogueTurn } from './dialogue.js';
import { LANGUAGE_TOPICS, TOPIC_GLOSS, type LanguageTopic } from './topics.js';

export interface UnderstandingPrompt {
  readonly system: string;
  readonly user: string;
}

/**
 * The two messages a classification is asked with, built so that they can be read in a test.
 *
 * The whole instruction is here rather than in a template string at the call site, because what the
 * model is told determines what it can answer, and a prompt that lives beside the transport is a
 * prompt nobody can pin without a network.
 */
export function buildUnderstandingPrompt(text: string, previous: DialogueTurn | null): UnderstandingPrompt {
  const topics = LANGUAGE_TOPICS.map((topic) => `- ${topic}：${TOPIC_GLOSS[topic]}`).join('\n');

  const followUp =
    previous === null
      ? ''
      : `\n这个人上一轮问的是：${previous.topic}。如果这一次他是在追问那一轮（例如「那刚才那个呢」），就回答同一个词。\n`;

  return Object.freeze({
    system:
      '你是 Hikari 的语言理解部分，只做一件事：把人的一句话归入下面四个主题之一。\n\n' +
      `${topics}\n${followUp}\n` +
      '规则：\n' +
      '- 只回答上面四个词中的一个。不要解释，不要标点，不要写别的任何内容。\n' +
      '- 这四个主题以外的问题你回答不了，也不要试着回答。\n' +
      '- 你不知道任何关于现实的事实，也不要陈述任何事实：事实由 Hikari 的其它部分提供，你只负责选词。',
    user: text,
  });
}

/**
 * The one way a model's answer becomes a topic: an exact match against the closed set.
 *
 * Normalization stops at case and at the punctuation a model wraps a bare word in, and it stops there
 * on purpose. Accepting a *sentence* that contains a topic name — "答案是 current-context", "我想你
 * 是在问 desktop-state" — would be exactly the prose channel this file exists to close, and it would
 * close it only for the phrasings someone thought of. So a whole-string match is the rule, and
 * anything else returns `undefined`, which the caller turns into a refusal.
 *
 * `undefined` here is the `unclassified` result. It is not a topic, it cannot be stored as one, and
 * the caller must not put the model's own words in front of a human to explain it — see `plugin.ts`
 * for what a refusal says instead, and why it says the same thing whatever the model wrote.
 */
export function readUnderstanding(content: string): LanguageTopic | undefined {
  const normalized = content
    .trim()
    .toLowerCase()
    .replace(/^[`'"]+/, '')
    .replace(/[`'"。.!！]+$/, '');

  return LANGUAGE_TOPICS.find((topic) => topic === normalized);
}
