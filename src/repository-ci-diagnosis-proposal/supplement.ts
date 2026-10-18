// The model-written supplement, as a value Attention can attach to a message it was already going to
// send.
//
// This file is the whole of the supplement slice, and its shape is the answer to one question: how do
// you let a model write something a human reads without letting it become a second decider? The answer
// here is three narrowings and no fourth.
//
// The first narrowing is the door. The model is only asked about `insufficient-evidence` with
// `missing: 'commit-comparison-indeterminate'` — the one arm where the deterministic judgement has
// nothing to say and the materials are richest. Every other arm already carries a suggestion derived
// from a fact, and a model sentence next to one of those would be a second opinion about a question
// that was already answered.
//
// The second narrowing is what the answer may contain. It is a `text` and a list of `cited` strings, and
// every cited string must appear verbatim in the materials. That check is not a quality judgement — it
// cannot tell a good suggestion from a bad one — and it is not trying to be. It is the one property a
// reader can verify without trusting the model: if the supplement points at a commit, a step or a file
// that is not in the materials, this file refuses to attach it. A model that invents a plausible-looking
// run id fails here rather than in front of a human.
//
// The third narrowing is failure. Every way this can go wrong — no endpoint configured, a material that
// is not there for a reason that is a failure rather than a `pending`, a model that answers late or
// badly or not at all, an answer that cites something absent — ends in the same value: `undefined`, and
// the caller sends the message it was already going to send. Nothing here can stop a notification, and
// nothing here writes a fact: a failed supplement is not a domain event and does not belong in the
// chronicle.
//
// What is deliberately *not* here: a determination of the cause, a severity, a recommended action, or a
// claim about what made the run fail. The frozen boundary lists those as out of scope for reasons that
// have not changed — Hikari does not have a causal model of a CI failure, and a model that supplies one
// in confident prose is not supplying a fact.

import type { GitHubCiRunMaterials } from '../github-ci/materials.js';
import type { RepositoryCiAttentionOccurrence } from '../repository-ci-attention/types.js';

import type { RepositoryCiDiagnosisProposal } from './types.js';

/**
 * What Attention hands over: the failure it is about to announce, and the judgement it already made.
 */
export interface RepositoryCiDiagnosisSupplementRequest {
  readonly occurrence: RepositoryCiAttentionOccurrence;
  readonly proposal: RepositoryCiDiagnosisProposal;
}

/**
 * A supplement that passed verification: the words, and the lines of material they were checked against.
 *
 * It carries no label, no blank line and no line breaks of its own. The label that says "model-written"
 * is part of the message's layout, and the module that owns the layout is the one that owns the send;
 * a value returned from here is content, not a message. Splitting the two is what makes "the label is
 * always there when the content is" a property of one writer instead of a convention two writers share.
 */
export interface RepositoryCiDiagnosisSupplementContent {
  readonly text: string;
  readonly cited: readonly string[];
}

export interface RepositoryCiDiagnosisSupplement {
  /**
   * The verified content, or `undefined` for "send what you were going to send".
   *
   * Every reason a supplement cannot be produced — no model configured, a branch this one does not
   * reach, a material that is absent where it was required, a model that answers late or badly, a
   * citation that cannot be found in the material — ends in `undefined`, and the caller sends the
   * message it already had.
   */
  attach(request: RepositoryCiDiagnosisSupplementRequest): Promise<RepositoryCiDiagnosisSupplementContent | undefined>;
}

export interface RepositoryCiDiagnosisSupplementModel {
  /** The operator's endpoint, exactly as the Language plugin's own model seam takes it. */
  readonly endpoint: string;
  readonly model: string;
  /** How long a supplement may take before the message goes without it. Explicit, never defaulted. */
  readonly budgetMs: number;
}

export interface RepositoryCiDiagnosisSupplementOptions {
  /**
   * The materials read, injected rather than reached for: this module asks `github-ci` and does not
   * speak to GitHub. The read is per failure, on the one arm where a supplement is possible, and it
   * happens only when a model is configured.
   */
  readonly readMaterials: (query: {
    readonly repository: string;
    readonly runId: number;
    readonly headSha: string;
  }) => Promise<GitHubCiRunMaterials>;
  /** Absent means no model is configured: `attach` answers `undefined` and calls nothing. */
  readonly model?: RepositoryCiDiagnosisSupplementModel | undefined;
  /**
   * Where a failure goes when it is worth telling an operator about. The runner owns stderr, so this
   * module takes the line as an argument rather than writing to a stream it does not own — and the
   * absent default is silence, which is the right default for a test.
   */
  readonly log?: ((line: string) => void) | undefined;
}

/** The one arm a supplement is possible on, named here so the door is visible rather than implied. */
const SUPPLEMENT_ARM = 'commit-comparison-indeterminate';

const MAX_TEXT_CHARS = 600;
const MAX_CITED = 5;
const MAX_CITED_CHARS = 200;
/** Answers larger than this are not read as a supplement: the shape is small, and a big answer is one. */
const MAX_ANSWER_BYTES = 64 * 1024;
/** Room for the chain of thought a reasoning model may emit before its answer. */
const MAX_COMPLETION_TOKENS = 4_096;

const SYSTEM_PROMPT = [
  '你在为一条已经发给人的 CI 失败通知写一段补充复查建议。',
  '',
  '可用的材料只有下面这一段，全部来自 GitHub：这次运行的作业与步骤、它改动过的文件、以及失败步骤附近的日志片段。',
  '',
  '规则：',
  '1. 只依据材料说话。材料里没有的提交 id、run 号、文件名、步骤名、数字，一个都不要写。',
  '2. 不要说原因。你可以指向某一步失败、某个文件改动、日志里的某一行，但不能说它们导致了失败。',
  '3. 不要再重复通知里已经给出的那条建议，只补它没有覆盖的、值得先看一眼的具体位置。',
  '4. 材料不足以支持任何具体观察时，输出 {"deficient": true}，不要勉强写。',
  '5. 中文，不超过 600 字，不要标题，不要列表以外的排版。',
  '',
  '输出一个 JSON 对象，二选一：',
  '{"text": "要附在通知末尾的话", "cited": ["材料里逐字出现过的字符串", ...]}',
  '{"deficient": true}',
  '',
  'cited 里的每一项都必须能在材料里逐字找到，否则这段话不会被采用。',
].join('\n');

interface ModelAnswer {
  readonly text: string;
  readonly cited: readonly string[];
}

// Three outcomes, and the distinction between the last two is the one that matters: an abstention is
// the model doing what the prompt asked, and a malformed answer is the model not answering the
// protocol at all. Both end in "no supplement", and only one of them is worth a line in a log — the
// difference is between a model that had nothing to say and a model that is not speaking the shape,
// and an operator chasing the second one needs to be able to tell them apart.
type ParsedAnswer =
  | { readonly kind: 'answer'; readonly text: string; readonly cited: readonly string[] }
  | { readonly kind: 'abstained' }
  | { readonly kind: 'malformed' };

const ABSTAINED: ParsedAnswer = Object.freeze({ kind: 'abstained' });
const MALFORMED: ParsedAnswer = Object.freeze({ kind: 'malformed' });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The materials, as the model reads them: a projection of the answer rather than the answer itself.
 *
 * Nothing is summarised and nothing is interpreted. A material that is `missing` or `pending` does not
 * appear here at all — this module only runs when the required materials are present, and the optional
 * one being absent means the prompt is shorter rather than the prompt saying "no logs".
 */
function materialsForModel(materials: GitHubCiRunMaterials): string {
  const subject: Record<string, unknown> = {
    repository: materials.repository,
    runId: materials.runId,
    headSha: materials.headSha,
  };

  if (materials.jobs.kind === 'present') {
    subject.jobs = materials.jobs.value.map((job) => ({
      name: job.name,
      conclusion: job.conclusion,
      steps: job.steps.map((step) => ({ name: step.name, conclusion: step.conclusion })),
    }));
  }

  if (materials.changedFiles.kind === 'present') {
    subject.changedFiles = materials.changedFiles.value.files.map((file) => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch.kind === 'present' ? file.patch.text : null,
    }));
    subject.changedFilesTotal = materials.changedFiles.value.totalFiles;
    subject.changedFilesOmitted = materials.changedFiles.value.omittedFiles;
  }

  if (materials.log.kind === 'present') {
    subject.log = {
      window: materials.log.value.window,
      step: materials.log.value.step,
      truncated: materials.log.value.truncated,
      text: materials.log.value.text,
    };
  }

  return JSON.stringify(subject);
}

/** Every string a citation could legitimately point at, taken from the same projection the model saw. */
function citableCorpus(materialsText: string): string {
  return materialsText;
}

function parseAnswer(content: string): ParsedAnswer {
  const trimmed = content.trim();
  // A model that wraps its JSON in a fence is still answering JSON, and refusing that answer would be
  // this module being stricter about packaging than about content. Only the fence is stripped; anything
  // else around the object is not guessed at.
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
    : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    return MALFORMED;
  }

  if (!isObject(parsed)) return MALFORMED;

  // The honest abstention. It is an answer and not a failure, which is why it is not logged.
  if (parsed.deficient === true) return ABSTAINED;

  const { text, cited } = parsed;
  if (typeof text !== 'string') return MALFORMED;
  const body = text.trim();
  if (body.length === 0 || body.length > MAX_TEXT_CHARS) return MALFORMED;

  if (!Array.isArray(cited) || cited.length === 0 || cited.length > MAX_CITED) return MALFORMED;

  const values: string[] = [];
  for (const entry of cited) {
    if (typeof entry !== 'string') return MALFORMED;
    const value = entry.trim();
    if (value.length === 0 || value.length > MAX_CITED_CHARS) return MALFORMED;
    values.push(value);
  }

  return { kind: 'answer', text: body, cited: Object.freeze(values) };
}

function gapLine(reason: string): string {
  return `模型补充：材料读取失败（${reason}）→ 未附加`;
}

export function createRepositoryCiDiagnosisSupplement(
  options: RepositoryCiDiagnosisSupplementOptions,
): RepositoryCiDiagnosisSupplement {
  const { readMaterials, model, log } = options;

  function note(line: string): void {
    if (log === undefined) return;
    try {
      log(line);
    } catch {
      // A logger that throws is a logger, not a decision. Swallowing keeps the one guarantee this
      // module has: nothing in it can stop a notification.
    }
  }

  async function askModel(materialsText: string, budgetMs: number): Promise<ModelAnswer | undefined> {
    if (model === undefined) return undefined;

    let response: Response;
    try {
      response = await fetch(model.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: model.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: materialsText },
          ],
          temperature: 0,
          max_tokens: MAX_COMPLETION_TOKENS,
          stream: false,
        }),
        signal: AbortSignal.timeout(budgetMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      note(
        name === 'TimeoutError' || name === 'AbortError'
          ? `模型补充：超时（${budgetMs} ms）→ 未附加`
          : '模型补充：端点不可用 → 未附加',
      );
      return undefined;
    }

    if (!response.ok) {
      note('模型补充：端点不可用 → 未附加');
      return undefined;
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      note('模型补充：端点不可用 → 未附加');
      return undefined;
    }

    if (body.length > MAX_ANSWER_BYTES) {
      note('模型补充：格式错误 → 未附加');
      return undefined;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      note('模型补充：格式错误 → 未附加');
      return undefined;
    }

    const choices = isObject(payload) ? payload.choices : undefined;
    if (!Array.isArray(choices) || choices.length === 0) {
      note('模型补充：格式错误 → 未附加');
      return undefined;
    }

    const first = choices[0];
    const message = isObject(first) ? first.message : undefined;
    const content = isObject(message) ? message.content : undefined;
    if (typeof content !== 'string' || content.trim() === '') {
      note('模型补充：格式错误 → 未附加');
      return undefined;
    }

    const parsed = parseAnswer(content);
    if (parsed.kind !== 'answer') {
      if (parsed.kind === 'malformed') note('模型补充：格式错误 → 未附加');
      return undefined;
    }

    const corpus = citableCorpus(materialsText);
    const missing = parsed.cited.filter((value) => !corpus.includes(value));
    if (missing.length > 0) {
      note(`模型补充：引用不可核验（${missing.length} 处）→ 未附加`);
      return undefined;
    }

    return { text: parsed.text, cited: parsed.cited };
  }

  async function attach(
    request: RepositoryCiDiagnosisSupplementRequest,
  ): Promise<RepositoryCiDiagnosisSupplementContent | undefined> {
    // The door. Everything else is unreachable from another arm, and an `undefined` here is not a
    // failure: it is the arm having nothing to add.
    const { proposal } = request;
    if (proposal.kind !== 'insufficient-evidence' || proposal.missing !== SUPPLEMENT_ARM) {
      return undefined;
    }

    if (model === undefined) return undefined;

    const { repository, runId, headSha } = request.occurrence;

    let materials: GitHubCiRunMaterials;
    try {
      materials = await readMaterials({ repository, runId, headSha });
    } catch {
      note('模型补充：材料读取失败（transport）→ 未附加');
      return undefined;
    }

    // The identity is checked before anything else about the materials is: a body that came back for a
    // different run is not a partial material, it is the wrong one.
    //
    // It is checked silently, and that is the Human's ruling rather than an oversight: a mismatch is not
    // a material that failed to arrive and not a model that failed to answer. It is two identifiers not
    // being equal, which the observation side has already handled by reporting the pairing it saw. A
    // line here would put a second, differently-worded account of the same non-event into the operator's
    // log — which is how one condition starts to look like two.
    if (materials.identity !== 'confirmed') return undefined;

    const jobs = materials.jobs;
    if (jobs.kind === 'pending') return undefined;
    if (jobs.kind === 'missing') {
      note(gapLine(`jobs:${jobs.reason}`));
      return undefined;
    }

    const changedFiles = materials.changedFiles;
    if (changedFiles.kind === 'pending') return undefined;
    if (changedFiles.kind === 'missing') {
      note(gapLine(`changedFiles:${changedFiles.reason}`));
      return undefined;
    }

    // The log is not required. Its absence lowers the ceiling of what can be said rather than deciding
    // whether anything can be said — and a `missing('authentication')` is already reported above as the
    // material read failure it is, not silently read as "the log had nothing in it".
    const materialsText = materialsForModel(materials);

    const answer = await askModel(materialsText, model.budgetMs);
    if (answer === undefined) return undefined;

    // No positive line here. "已附加" is a claim about the message, and this module does not write the
    // message: it can return content that the send-side layout then refuses. The line is written by the
    // module that appends, once the words are actually in the notification.
    return { text: answer.text, cited: answer.cited };
  }

  return Object.freeze({ attach });
}
