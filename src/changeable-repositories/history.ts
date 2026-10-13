// Reading the authorization back out of the fact history, which is the half the sibling does not have.
//
// A work focus starts empty on every activation and never reads its history: its set is what a human
// said during this lifetime of the Runtime, and that is the whole of it. This authorization is
// persistent by ruling, so a new activation has to rebuild it — and the only place it lives is here.
//
// The rebuild is one fact, not a replay. Every payload carries the complete set its transition left
// behind, so the newest fact of this family *is* the answer and there is no sequence to fold, no
// ordering to trust, and no second place the set could disagree with itself. A reader that had to replay
// would also have to decide what to do about a gap, and this design has no gaps to decide about.
//
// **What it does when it cannot read its own history: it refuses to activate.** Not "empty", and the
// difference is the whole point of this file. Reading an unreadable record as "nothing is authorized"
// fails closed behaviourally — no check would pass — but it does so by telling the human something
// false: `status` would say they had authorized nothing, when what actually happened is that Hikari
// cannot tell. An authority that cannot be read is not an authority, so the activation ends and the
// client says the ingress is not there. That is louder and it is true.

import type { ChronicleService } from '../chronicle/index.js';
import { ChangeableRepositoriesError } from './errors.js';
import {
  emptyChangeableRepositories,
  type ChangeableRepositoriesState,
} from './state.js';

/** The version this build writes and the only one it will read. */
const CHANGEABLE_REPOSITORIES_FACT_VERSION = 1;

const DECLARED = 'changeable-repositories.declared';
const REPLACED = 'changeable-repositories.replaced';
const CLEARED = 'changeable-repositories.cleared';

/**
 * The three fields this file reads, and no more.
 *
 * Named structurally rather than by importing the chronicle's fact type: this reader does not care what
 * else a stored fact carries, and a local type stating exactly what it looks at is one fewer place that
 * has to change the day the stored shape grows a field nobody here reads.
 */
interface StoredFact {
  readonly type: string;
  readonly version: number;
  readonly payload: unknown;
}

/**
 * The set as the history leaves it, or an activation-ending error.
 *
 * The newest fact of this family wins outright, and the search walks backwards because that is what
 * "newest" means here. Facts belonging to other families are not this reader's business and are passed
 * over without comment — the same Chronicle holds every plugin's occurrences, and a reader that
 * complained about the others would be claiming a Chronicle per family.
 */
export async function readChangeableRepositories(
  chronicle: ChronicleService,
): Promise<ChangeableRepositoriesState> {
  const facts = await chronicle.read();

  for (let at = facts.length - 1; at >= 0; at -= 1) {
    const fact = facts[at] as StoredFact | undefined;
    if (fact === undefined) continue;
    if (fact.type !== DECLARED && fact.type !== REPLACED && fact.type !== CLEARED) continue;

    requireKnownVersion(fact);
    // `cleared` carries no payload: an empty set can only hold one value, so a field repeating it would
    // be a field with one legal content. A reader reconstructing from it knows the answer without being
    // told, which is exactly the case `facts.ts` says it is.
    if (fact.type === CLEARED) return emptyChangeableRepositories();
    return Object.freeze({ repositories: readMembers(fact) });
  }

  return emptyChangeableRepositories();
}

// A version this build does not speak is not guessed at. The alternative — treating it as empty — is the
// failure this whole file is written against: it would silently un-authorize everything a human
// declared, and report the result as a fact about what they had said.
function requireKnownVersion(fact: StoredFact): void {
  if (fact.version === CHANGEABLE_REPOSITORIES_FACT_VERSION) return;
  throw new ChangeableRepositoriesError(
    `可改仓库的记录使用了本机不认识的版本 ${String(fact.version)}，因此无法确定现在授权了什么。`,
  );
}

function readMembers(fact: StoredFact): readonly string[] {
  const { payload } = fact;
  if (typeof payload !== 'object' || payload === null) throw malformed();
  const value = (payload as Record<string, unknown>).repositories;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw malformed();
  return Object.freeze([...(value as string[])]) as readonly string[];
}

function malformed(): ChangeableRepositoriesError {
  return new ChangeableRepositoriesError(
    '可改仓库的记录缺少它应有的目录集合，因此无法确定现在授权了什么。',
  );
}
