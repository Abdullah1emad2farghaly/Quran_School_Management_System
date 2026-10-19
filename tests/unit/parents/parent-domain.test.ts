import { describe, expect, it } from 'vitest';
import { Parent, ParentEventTypes, ParentSchoolLink, isSameParentName, normalizeParentName } from '../../../src/modules/17-parents/public';

const clock = { now: () => new Date('2026-10-18T10:00:00Z') };
const code = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return (e as { code?: string }).code ?? 'NOT_APP_ERROR';
  }
};

describe('Parent name (exactly three parts, the shared Identity rule)', () => {
  it('trims, collapses spaces and applies Unicode NFC', () => {
    expect(normalizeParentName('  أحمد   محمد \t علي ')).toBe('أحمد محمد علي');
    expect(normalizeParentName('Jose\u0301 Maria Lopez')).toBe('Jos\u00e9 Maria Lopez');
  });

  it('needs EXACTLY three parts: two and four parts are invalid', () => {
    expect(code(() => normalizeParentName('أحمد محمد'))).toBe('INVALID_PARENT_NAME');
    expect(code(() => normalizeParentName('أحمد'))).toBe('INVALID_PARENT_NAME');
    expect(code(() => normalizeParentName('أحمد محمد علي حسن'))).toBe('INVALID_PARENT_NAME');
    expect(normalizeParentName('أحمد محمد علي')).toBe('أحمد محمد علي');
  });

  it('rejects non-text, empty, control characters and names over 200 characters', () => {
    for (const bad of [undefined, null, 5, '', '   ', 'a b c\u0007', `${'a'.repeat(100)} ${'b'.repeat(100)} c`]) {
      expect(code(() => normalizeParentName(bad))).toBe('INVALID_PARENT_NAME');
    }
    expect(normalizeParentName(`${'a'.repeat(90)} ${'b'.repeat(90)} c`)).toHaveLength(183);
  });

  it('compares full names exactly: Latin case is ignored but Arabic letters are never folded', () => {
    expect(isSameParentName('Ahmed Mohamed Ali', '  ahmed   mohamed ALI ')).toBe(true);
    expect(isSameParentName('أحمد محمد علي', 'احمد محمد علي')).toBe(false); // أ vs ا
    expect(isSameParentName('فاطمة محمد علي', 'فاطمه محمد علي')).toBe(false); // ة vs ه
    expect(isSameParentName('أحمد محمد علي', 'أحمد محمد حسن')).toBe(false);
    expect(isSameParentName('x y', 'x y z')).toBe(false); // invalid input never matches
    expect(isSameParentName(null, 'أحمد محمد علي')).toBe(false); // a missing name never matches
  });
});

describe('Parent entity and Parent-to-School link', () => {
  it('registers without storing a name (the name is the account\'s) and records only identifiers in the event', () => {
    const parent = Parent.register({ userId: 'u1', organizationId: 'o1', createdBy: 'a1', clock });
    expect(parent.snapshot).not.toHaveProperty('fullName');
    const events = parent.pullDomainEvents();
    expect(events.map((e) => e.eventType)).toEqual([ParentEventTypes.PARENT_REGISTERED]);
    expect(Object.keys(events[0]!.payload as object).sort()).toEqual(['actorId', 'organizationId', 'parentId', 'userId']);
  });

  it('records ParentAddressChanged when a new current address was stored', () => {
    const parent = Parent.register({ userId: 'u1', organizationId: 'o1', createdBy: 'a1', clock });
    parent.pullDomainEvents();
    parent.addressChanged('a1', clock);
    expect(parent.pullDomainEvents().map((e) => e.eventType)).toEqual([ParentEventTypes.PARENT_ADDRESS_CHANGED]);
  });

  it('a school link is active when created, keeps its history when removed and cannot be removed twice', () => {
    const link = ParentSchoolLink.link({ parentId: 'p1', userId: 'u1', organizationId: 'o1', schoolId: 's1', linkedBy: 'a1', clock });
    expect(link.isActive).toBe(true);
    link.pullDomainEvents();
    link.unlink('a2', clock);
    expect(link.isActive).toBe(false);
    expect(link.snapshot).toMatchObject({ schoolId: 's1', unlinkedBy: 'a2', linkedBy: 'a1' });
    expect(link.pullDomainEvents().map((e) => e.eventType)).toEqual([ParentEventTypes.PARENT_SCHOOL_LINK_REMOVED]);
    expect(() => link.unlink('a2', clock)).toThrow();
  });
});
