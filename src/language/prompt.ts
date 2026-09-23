// What this plugin says to a model before the conversation starts.
//
// It is much shorter than the prompt it replaces, and the reason is that the old one had a job this one
// does not. That prompt asked a model to pick one of four words and nothing else — the whole document
// existed to make a single token come back, and every rule in it was there to keep the model from
// saying more. This one is handed a tool list instead, so what is left to say is the part the tool list
// cannot say: what Hikari is, that reading is the only way it knows anything, and that it may answer
// without reading when the question was not about Hikari at all.
//
// The permission to simply talk is stated plainly because it is new and because a model that does not
// know it has one will reach for a tool instead. That is the failure this paragraph exists to prevent:
// "ayobro" is not a question about the user's focus, and a model that reads the work focus to answer it
// has made the answer worse, not better. Chatting is a first-class outcome now rather than a fallback.
//
// The fact rule is carried over unchanged in meaning. It is the invariant the whole surface rests on —
// the model chooses what to read, and the lines it is shown are the lines the human will see — and it
// is stated here in the form that fits a tool-using model: you do not know anything about the user's
// machine, you can only go and look, and what you looked at is what gets said.
//
// The referent paragraph is the one piece that survives the old prompt nearly intact, because the
// situation it describes does too. A follow-up like "那现在呢" is not a question about a capability; it
// is a question about what the previous turn was about, and the model is the only thing in the loop
// that can tell the two apart. `previous` is what it is given to do that with, and it names capabilities
// in the same vocabulary the tool list uses, so "keep reading the same thing" is expressible.
//
// Where the answers come from is stated so that the model does not try to write one. Its prose is either
// the entire answer (when it read nothing) or it is discarded (when it read something) — the sections
// in this file say which case is which without dressing it up as a role.

import type { DialogueTurn } from './dialogue.js';

/**
 * Build the system message, optionally carrying what the previous turn was grounded in.
 *
 * The prompt is a pure function of `previous`, so there is no state to hold and no prompt object to
 * thread around. Nothing in it names a specific capability or a specific domain: it tells the model that
 * reading is how it learns things and lets the tool list say what can be read, which is what keeps this
 * file from becoming a second place the exposure set is written down. An earlier draft named two
 * domains in a parenthetical — "what this person is focused on, which application is on screen" — as an
 * example of what a fact question looks like, and it had to go: those are the owners' own descriptions
 * translated into this file's words, and a translation is a second statement of what another domain's
 * capability covers, drifting from the first the moment either is edited. Whether a sentence needs a
 * reading is decided from the tool list and the sentence, which is the only material the decision should
 * ever have needed.
 */
export function buildSystemPrompt(previous: DialogueTurn | null): string {
  const referent =
    previous === null
      ? ''
      : `\n\n上一轮这个人问的问题，你已经读过：${previous.reads.join('、')}。` +
        '如果这一轮的问题是在接着上一轮说（比如「那现在呢」「还有呢」），就接着读同样的东西；' +
        '如果这一轮问的是别的事情，就按它自己的意思重新决定要读什么。';

  return [
    '你是 Hikari 的语言部分。Hikari 是运行在这台机器上的一个程序，它自己观察这台机器，',
    '并且只能通过它观察到的内容来了解这台机器上正在发生什么。',
    '',
    '你可以调用下面列出的工具去读取 Hikari 已经掌握的东西。',
    '',
    '关于这台机器和你面前的这个人，你自己什么都不知道。你不记得任何事，也看不到任何东西。',
    '唯一能让 Hikari 了解现实的途径，就是你去读它。所以：',
    '',
    '- 如果为了诚实回答这句话，必须去读 Hikari 现在观察到的东西，就调用工具去读。',
    '  读回来的内容会被展示给这个人，就是这次回答的全部内容。',
    '- 如果这个人不是在问 Hikari 知道的事情（打招呼、随口聊两句、说一句自己的感受），',
    '  就直接用自然语言回话，什么也不用读。这是允许的，也是应该的。',
    '',
    '不要自己编造事实，也不要在读完之后补充一句自己的理解——比如读到前台是某个应用，',
    '不要接着说这个人大概在做什么。读回来的东西是什么，回答就是什么。',
    '',
    '你现在只负责决定「还需要读什么」。读回来的内容是什么意思，由 Hikari 自己说。',
    referent,
  ].join('\n');
}
