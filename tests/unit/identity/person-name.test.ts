import { describe, expect, it } from 'vitest';
import { FixedClock, type TransactionContext, type UnitOfWork } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../../src/modules/06-domain-events-outbox/public';
import {
  BcryptPasswordHasher,
  IdentityService,
  InMemoryUserRepository,
  checkPersonName,
  isSamePersonName,
  normalizePersonName,
} from '../../../src/modules/08-identity-core/public';

const codeOf = (p: Promise<unknown> | (() => unknown)) =>
  (typeof p === 'function' ? Promise.resolve().then(p) : p).then(
    () => 'NO_ERROR',
    (e: { code?: string }) => e.code ?? 'NOT_APP_ERROR',
  );

describe('person name rule: EXACTLY three parts', () => {
  it('accepts three parts and normalizes whitespace and Unicode', () => {
    expect(normalizePersonName('أحمد محمد علي')).toBe('أحمد محمد علي');
    expect(normalizePersonName('  أحمد \t محمد\n\n علي ')).toBe('أحمد محمد علي');
    expect(normalizePersonName('Jose\u0301 Maria Lopez')).toBe('Jos\u00e9 Maria Lopez');
  });

  it.each([
    ['two parts', 'أحمد محمد', 'WRONG_PART_COUNT'],
    ['one part', 'أحمد', 'WRONG_PART_COUNT'],
    ['four parts', 'أحمد محمد علي حسن', 'WRONG_PART_COUNT'],
    ['empty', '', 'EMPTY'],
    ['whitespace only', ' \t ', 'EMPTY'],
    ['control character', 'أ ب\u0007 ج', 'CONTROL_CHARACTERS'],
    ['too long', `${'ا'.repeat(100)} ${'ب'.repeat(100)} ج`, 'TOO_LONG'],
    ['not text', 42, 'NOT_TEXT'],
    ['missing', undefined, 'NOT_TEXT'],
  ])('rejects %s', (_label, input, reason) => {
    expect(checkPersonName(input)).toEqual({ ok: false, reason });
    expect(() => normalizePersonName(input)).toThrow();
  });

  it('a missing middle part cannot hide behind extra spaces ("أحمد  علي" is two parts)', () => {
    expect(checkPersonName('أحمد  علي')).toMatchObject({ ok: false, reason: 'WRONG_PART_COUNT' });
  });

  it('matches by exact normalized text: Latin case ignored, Arabic letters NEVER folded', () => {
    expect(isSamePersonName('أحمد محمد علي', ' أحمد   محمد علي ')).toBe(true);
    expect(isSamePersonName('Ahmed Mohamed Ali', 'ahmed mohamed ALI')).toBe(true);
    expect(isSamePersonName('أحمد محمد علي', 'احمد محمد علي')).toBe(false);
    expect(isSamePersonName('فاطمة محمد علي', 'فاطمه محمد علي')).toBe(false);
    expect(isSamePersonName('على محمد حسن', 'علي محمد حسن')).toBe(false); // ى vs ي
    expect(isSamePersonName(null, 'أحمد محمد علي')).toBe(false);
  });
});

describe('IdentityService: the canonical personal name of the account', () => {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const tx = {} as TransactionContext;
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
  const setup = () =>
    new IdentityService({ repository: new InMemoryUserRepository(), hasher: new BcryptPasswordHasher(4), unitOfWork, outbox: new OutboxService(new InMemoryOutboxStore()), clock });

  it('stores a validated name at creation, and an account created without one has none', async () => {
    const service = setup();
    const named = await service.createUser({ phone: '01012345678', password: 'secret1', fullName: ' أحمد  محمد علي ' });
    expect(named.fullName).toBe('أحمد محمد علي');
    expect((await service.getById(named.id)).fullName).toBe('أحمد محمد علي');
    const nameless = await service.createUser({ phone: '01012345679', password: 'secret1' });
    expect(nameless.fullName).toBeNull();
  });

  it('refuses an invalid name at creation and creates no account', async () => {
    const service = setup();
    expect(await codeOf(service.createUser({ phone: '01012345678', password: 'secret1', fullName: 'أحمد محمد' }))).toBe('INVALID_PERSON_NAME');
    expect(await service.findByPhone('01012345678')).toBeUndefined();
  });

  it('ensureFullName sets a missing name once, accepts the same name, and NEVER overwrites a different one', async () => {
    const service = setup();
    const user = await service.createUser({ phone: '01012345678', password: 'secret1' });
    expect((await service.ensureFullName(user.id, 'أحمد محمد علي')).fullName).toBe('أحمد محمد علي');
    expect((await service.ensureFullName(user.id, ' أحمد  محمد علي ')).fullName).toBe('أحمد محمد علي');
    expect(await codeOf(service.ensureFullName(user.id, 'محمود خالد سعيد'))).toBe('PERSON_NAME_MISMATCH');
    expect(await codeOf(service.ensureFullName(user.id, 'احمد محمد علي'))).toBe('PERSON_NAME_MISMATCH');
    expect(await codeOf(service.ensureFullName(user.id, 'أحمد محمد'))).toBe('INVALID_PERSON_NAME');
    expect(await codeOf(service.ensureFullName('00000000-0000-4000-8000-000000000000', 'أحمد محمد علي'))).toBe('USER_NOT_FOUND');
    expect((await service.getById(user.id)).fullName).toBe('أحمد محمد علي');
  });

  it('setting the name changes neither the password nor the pending password-change requirement', async () => {
    const service = setup();
    const user = await service.createUser({ phone: '01012345678', password: '5678', mustChangePassword: true });
    const named = await service.ensureFullName(user.id, 'أحمد محمد علي');
    expect(named.mustChangePassword).toBe(true);
    expect(await service.verifyPassword(user.id, '5678')).toBe(true);
  });
});
