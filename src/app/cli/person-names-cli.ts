import { checkPersonName, personNameKey } from '../../modules/08-identity-core/public';

/** Where an existing account's personal name could come from (names collected BEFORE the canonical `users.full_name` existed). */
export type NameSource = 'organization_admins.name' | 'schools.applicant_name';

export interface NameCandidate {
  readonly userId: string;
  readonly source: NameSource;
  readonly value: string | null;
}

export type Classification =
  | { readonly kind: 'fillable'; readonly userId: string; readonly name: string; readonly sources: readonly NameSource[] }
  | { readonly kind: 'needs-review'; readonly userId: string; readonly reason: 'NO_CANDIDATE' | 'NOT_EXACTLY_THREE_PARTS' | 'CONFLICTING_CANDIDATES'; readonly candidates: readonly string[] };

/**
 * Decides, for accounts WITHOUT a canonical name, which can be filled safely. Nothing is ever invented or guessed:
 *  - fillable: every recorded candidate is a valid exactly-three-part name and they all agree (same normalized name, Arabic letters never folded);
 *  - needs-review: no candidate, a candidate that is not exactly three parts, or candidates that disagree. A human decides; the tool never touches it.
 */
export function classifyAccounts(userIds: readonly string[], candidates: readonly NameCandidate[]): Classification[] {
  const byUser = new Map<string, NameCandidate[]>();
  for (const c of candidates) {
    if (c.value === null || c.value.trim() === '') continue;
    byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  }
  return userIds.map((userId): Classification => {
    const list = byUser.get(userId) ?? [];
    if (list.length === 0) return { kind: 'needs-review', userId, reason: 'NO_CANDIDATE', candidates: [] };
    const checked = list.map((c) => ({ c, r: checkPersonName(c.value) }));
    const raw = list.map((c) => c.value as string);
    if (checked.some((x) => !x.r.ok)) return { kind: 'needs-review', userId, reason: 'NOT_EXACTLY_THREE_PARTS', candidates: raw };
    const names = checked.map((x) => (x.r as { ok: true; name: string }).name);
    if (new Set(names.map(personNameKey)).size > 1) return { kind: 'needs-review', userId, reason: 'CONFLICTING_CANDIDATES', candidates: raw };
    return { kind: 'fillable', userId, name: names[0]!, sources: [...new Set(list.map((c) => c.source))] };
  });
}

export function parsePersonNamesArgs(argv: readonly string[]): { mode: 'report' | 'apply' } | { error: string } {
  const [command, ...rest] = argv;
  if ((command !== 'report' && command !== 'apply') || rest.length > 0) return { error: 'Usage: person-names <report|apply>' };
  return { mode: command };
}
