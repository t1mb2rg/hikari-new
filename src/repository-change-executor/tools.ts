// The tools this build admits, and the reading of what a model asked for.
//
// The shape is `src/language/tools.ts`'s, and for the same reason it gives: the list is a *parameter*
// rather than a registry. There is no lookup table a name could be added to at runtime, no plugin hook
// that contributes a capability, and no place where a model's output could enlarge the set of things
// that can happen. §8.1 of the boundary review settled that the tool set is admitted in advance and the
// model cannot add to it; the way that becomes true here is by the set being a frozen array in this
// file, and by the only lookup against it being a linear scan of *that* array.
//
// Three effects exist and they are not a hierarchy: `read` touches nothing, `write` changes the working
// tree, and the two git-writing tools change what other people can see. `git_push` is the one that
// cannot be taken back, which is why the record has to say it happened rather than why this file
// refuses it — the authorization for it is the human's, given one word at a time, and this file's job is
// to make sure the *only* way to reach it is the one word that was given.
//
// There is no `shell`, no `run_command`, no `delete`, no `network`. That is not a smaller version of a
// general executor: it is the difference between an executor whose reachable actions can be listed and
// one whose cannot. A capability that is not in this array cannot be called, because a name that is not
// in it is not "rejected" — it is a name this build has never heard of, and those two are the same
// branch everywhere in this module.
//
// The wire schema is *generated* from the declarations below rather than written twice beside them. That
// is the whole reason the field list is data: a model offered a schema that disagreed with the reader
// would be a model asked for something this build then refuses, and the two cannot disagree if there is
// only one statement of what a tool takes.

import type { ModelTool } from '../language/model.js';

/** One argument a tool takes. Only strings exist here; a tool needing more is a tool not yet written. */
export interface RepositoryChangeToolField {
  readonly name: string;
  readonly description: string;
}

/**
 * One admitted tool.
 *
 * `effect` is carried rather than derived from the name: the budget and the record both ask "did this
 * run try to change anything", and answering that by matching names would make the answer a convention
 * about spelling rather than a property of the tool.
 */
export interface RepositoryChangeTool {
  readonly name: string;
  readonly description: string;
  readonly effect: 'read' | 'write';
  readonly fields: readonly RepositoryChangeToolField[];
}

const PATH_FIELD: RepositoryChangeToolField = Object.freeze({
  name: 'path',
  description: 'Repository-relative path, using forward slashes. Absolute paths are refused.',
});

/**
 * The whole set. Five reads and three writes, and nothing else.
 *
 * `git_diff` and `git_status` are separate tools rather than one with a flag, because a model that has
 * to choose a name is being asked a question whose answer this build can record, and a flag would move
 * that choice into a string this build would then have to parse.
 */
export const REPOSITORY_CHANGE_TOOLS: readonly RepositoryChangeTool[] = Object.freeze([
  Object.freeze({
    name: 'read_file',
    description: 'Read one text file from the repository.',
    effect: 'read',
    fields: Object.freeze([PATH_FIELD]),
  }),
  Object.freeze({
    name: 'list_directory',
    description: 'List the entries of one directory in the repository.',
    effect: 'read',
    fields: Object.freeze([PATH_FIELD]),
  }),
  Object.freeze({
    name: 'git_status',
    description: 'Show what the working tree has that is not committed.',
    effect: 'read',
    fields: Object.freeze([]),
  }),
  Object.freeze({
    name: 'git_diff',
    description: 'Show the unstaged changes in the working tree.',
    effect: 'read',
    fields: Object.freeze([]),
  }),
  Object.freeze({
    name: 'read_ci',
    description: 'Read the latest GitHub Actions run for this repository.',
    effect: 'read',
    fields: Object.freeze([]),
  }),
  Object.freeze({
    name: 'write_file',
    description: 'Create or replace one text file in the repository. This changes the working tree.',
    effect: 'write',
    fields: Object.freeze([
      PATH_FIELD,
      Object.freeze({
        name: 'content',
        description: 'The complete new contents of the file.',
      }),
    ]),
  }),
  Object.freeze({
    name: 'git_commit',
    description: 'Commit everything staged and unstaged in the working tree, with this message.',
    effect: 'write',
    fields: Object.freeze([
      Object.freeze({
        name: 'message',
        description: 'The commit message, used exactly as given.',
      }),
    ]),
  }),
  Object.freeze({
    name: 'git_push',
    description: 'Push the current branch to its remote. This cannot be taken back.',
    effect: 'write',
    fields: Object.freeze([]),
  }),
] as const satisfies readonly RepositoryChangeTool[]);

/** The wire shape of the whole set, built from the declarations above and from nothing else. */
export function toModelTools(tools: readonly RepositoryChangeTool[] = REPOSITORY_CHANGE_TOOLS): readonly ModelTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          tool.fields.map((field) => [field.name, { type: 'string', description: field.description }]),
        ),
        required: tool.fields.map((field) => field.name),
        // Sent as a request rather than relied on: `readToolArguments` re-checks everything it promises,
        // because a wire guarantee this build never verifies is a guarantee it does not have.
        additionalProperties: false,
      },
    },
  }));
}

/** The tool a model named, or `undefined` when it named something this build does not admit. */
export function findTool(
  name: string,
  tools: readonly RepositoryChangeTool[] = REPOSITORY_CHANGE_TOOLS,
): RepositoryChangeTool | undefined {
  return tools.find((tool) => tool.name === name);
}

/** What a call's arguments turned out to be. */
export type ToolArguments =
  | { readonly kind: 'given'; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: 'malformed'; readonly reason: string };

/**
 * Read the `arguments` string an OpenAI-compatible endpoint returned for one call.
 *
 * Every rule here refuses rather than repairs, and the reason is the one `language/tools.ts` states for
 * its own version: a call that renamed a field or sent an extra one is a call this build does not
 * understand, and quietly dropping the extra field would perform an action nobody asked for. What is
 * *not* refused is a tool that takes no arguments returning `{}` or an empty string — both mean "nothing
 * was sent", which is exactly what such a tool expects.
 *
 * The values are not trimmed beyond their edges. A file's contents are bytes the model chose, and the
 * first character it wrote is not this build's to delete.
 */
export function readToolArguments(raw: string, tool: RepositoryChangeTool): ToolArguments {
  const text = raw.trim();
  if (text === '') {
    return tool.fields.length === 0
      ? { kind: 'given', values: {} }
      : { kind: 'malformed', reason: `${tool.name} 需要参数：${tool.fields.map((field) => field.name).join('、')}。` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: 'malformed', reason: 'arguments 不是一个 JSON 对象。' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'malformed', reason: 'arguments 不是一个 JSON 对象。' };
  }

  const record = parsed as Readonly<Record<string, unknown>>;
  const expected = tool.fields.map((field) => field.name);
  const given = Object.keys(record);

  const extra = given.filter((name) => !expected.includes(name));
  if (extra.length > 0) {
    return { kind: 'malformed', reason: `${tool.name} 不认识这些参数：${extra.join('、')}。` };
  }

  const values: Record<string, string> = {};
  for (const field of tool.fields) {
    const value = record[field.name];
    if (typeof value !== 'string') {
      return { kind: 'malformed', reason: `${tool.name} 的 ${field.name} 必须是一个字符串。` };
    }
    values[field.name] = value;
  }

  return { kind: 'given', values };
}
