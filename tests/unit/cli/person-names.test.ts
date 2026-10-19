import { describe, expect, it } from 'vitest';
import { classifyAccounts, parsePersonNamesArgs, type NameCandidate } from '../../../src/app/cli/person-names-cli';

const c = (userId: string, source: NameCandidate['source'], value: string | null): NameCandidate => ({ userId, source, value });

describe('person-names backfill classification (nothing is invented)', () => {
  it('fills only accounts whose recorded names are all valid three-part names that agree', () => {
    const result = classifyAccounts(['u1', 'u2'], [
      c('u1', 'organization_admins.name', 'أحمد محمد علي'),
      c('u1', 'schools.applicant_name', ' أحمد  محمد علي '),
      c('u2', 'schools.applicant_name', 'سارة أحمد حسن'),
    ]);
    expect(result).toEqual([
      { kind: 'fillable', userId: 'u1', name: 'أحمد محمد علي', sources: ['organization_admins.name', 'schools.applicant_name'] },
      { kind: 'fillable', userId: 'u2', name: 'سارة أحمد حسن', sources: ['schools.applicant_name'] },
    ]);
  });

  it('never fills: no candidate, a two- or four-part name, or candidates that disagree (Arabic letters are not folded)', () => {
    const result = classifyAccounts(['none', 'two', 'four', 'conflict', 'folded'], [
      c('two', 'schools.applicant_name', 'أحمد محمد'),
      c('four', 'organization_admins.name', 'أحمد محمد علي حسن'),
      c('conflict', 'organization_admins.name', 'أحمد محمد علي'),
      c('conflict', 'schools.applicant_name', 'محمود خالد سعيد'),
      c('folded', 'organization_admins.name', 'أحمد محمد علي'),
      c('folded', 'schools.applicant_name', 'احمد محمد علي'),
    ]);
    expect(result.map((r) => (r.kind === 'needs-review' ? r.reason : 'FILLED'))).toEqual([
      'NO_CANDIDATE',
      'NOT_EXACTLY_THREE_PARTS',
      'NOT_EXACTLY_THREE_PARTS',
      'CONFLICTING_CANDIDATES',
      'CONFLICTING_CANDIDATES',
    ]);
  });

  it('ignores blank and null candidates', () => {
    expect(classifyAccounts(['u'], [c('u', 'schools.applicant_name', null), c('u', 'organization_admins.name', '   ')])).toEqual([
      { kind: 'needs-review', userId: 'u', reason: 'NO_CANDIDATE', candidates: [] },
    ]);
  });

  it('parses report and apply only', () => {
    expect(parsePersonNamesArgs(['report'])).toEqual({ mode: 'report' });
    expect(parsePersonNamesArgs(['apply'])).toEqual({ mode: 'apply' });
    expect(parsePersonNamesArgs([])).toHaveProperty('error');
    expect(parsePersonNamesArgs(['apply', '--force'])).toHaveProperty('error');
  });
});
