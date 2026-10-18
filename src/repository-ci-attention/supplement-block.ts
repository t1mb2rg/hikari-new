// How a verified supplement becomes part of the notification, decided in one place.
//
// The supplement module returns content and stops there: a text and the material lines it was checked
// against. Everything that makes the words identifiable as model-written — the blank line that separates
// them from the deterministic sentence, the fixed label, the line breaks — lives here, in the module that
// owns the send. Keeping it here is what makes the label unavoidable: there is no path from a verified
// supplement to the transport that skips this function, so "no label without content, no content without
// a label" is a property of the code rather than a promise two modules keep for each other.
//
// The label is a constant written by code. The model's answer shape has no field for it, and its text is
// also checked below for a line that copies it, so an answer cannot produce a second label or pass its
// own words off as the frozen one.

import type { RepositoryCiDiagnosisSupplementContent } from '../repository-ci-diagnosis-proposal/supplement.js';

/** The line that separates model-written words from everything else in the message. */
export const REPOSITORY_CI_SUPPLEMENT_LABEL = '补充复查建议（模型，不是规则判断）';

/**
 * The lines to append after the notification this plugin was already going to send, or `undefined` when
 * the content must not be attached.
 *
 * A blank line, the label, then the content on its own lines. The leading blank line belongs to the
 * layout and not to the content: the deterministic sentence ends the first part, and the supplement has
 * to read as an addition to it rather than as a continuation of the same paragraph.
 *
 * `undefined` is returned when the content carries a line equal to the label. A message with two label
 * lines would make the boundary between "derived from a fact" and "written by a model" ambiguous, which
 * is the one property this label exists to provide. The case is not expected — the answer shape has no
 * label field — and refusing the whole supplement is the fail-closed answer for the shapes nobody named.
 */
export function supplementBlock(
  content: RepositoryCiDiagnosisSupplementContent,
): readonly string[] | undefined {
  const lines = content.text.split('\n');
  const label = REPOSITORY_CI_SUPPLEMENT_LABEL.trim();
  if (lines.some((line) => line.trim() === label)) return undefined;
  return ['', REPOSITORY_CI_SUPPLEMENT_LABEL, ...lines];
}
