import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { User } from '../../../src/modules/08-identity-core/domain/entities/user';
import { IdentityEventTypes } from '../../../src/modules/08-identity-core/public';

const clock = new FixedClock(new Date('2026-10-07T10:00:00Z'));
const later = new FixedClock(new Date('2026-10-08T10:00:00Z'));
const make = () => User.create({ phone: '010 1234 5678', passwordHash: '$2b$04$hash', clock });
const codeOf = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
};

describe('User aggregate', () => {
  it('starts ACTIVE with a normalized phone, version 1, and a UserCreated event', () => {
    const user = make();
    expect(user.status).toBe('ACTIVE');
    expect(user.isActive).toBe(true);
    expect(user.phone).toBe('+201012345678');
    expect(user.version).toBe(1);
    const events = user.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventType: IdentityEventTypes.USER_CREATED,
      aggregateType: 'User',
      aggregateId: user.id,
      payload: { userId: user.id },
    });
    expect(user.pullDomainEvents()).toHaveLength(0);
  });

  it('rejects an invalid phone at creation', () => {
    expect(codeOf(() => User.create({ phone: 'nope', passwordHash: 'h', clock }))).toBe('INVALID_PHONE_NUMBER');
  });

  it('deactivates and reactivates (reversible) with timestamps and events', () => {
    const user = make();
    user.pullDomainEvents();

    user.deactivate(later);
    expect(user.status).toBe('INACTIVE');
    expect(user.isActive).toBe(false);
    expect(user.statusChangedAt).toEqual(new Date('2026-10-08T10:00:00Z'));
    expect(user.createdAt).toEqual(new Date('2026-10-07T10:00:00Z'));
    expect(user.pullDomainEvents().map((e) => e.eventType)).toEqual([IdentityEventTypes.USER_DEACTIVATED]);

    user.activate(later);
    expect(user.isActive).toBe(true);
    expect(user.pullDomainEvents().map((e) => e.eventType)).toEqual([IdentityEventTypes.USER_ACTIVATED]);
  });

  it('rejects invalid transitions', () => {
    const user = make();
    expect(codeOf(() => user.activate(clock))).toBe('USER_ALREADY_ACTIVE');
    user.deactivate(clock);
    expect(codeOf(() => user.deactivate(clock))).toBe('USER_ALREADY_INACTIVE');
  });

  it('replaces the password hash and records UserPasswordChanged', () => {
    const user = make();
    user.pullDomainEvents();
    user.replacePasswordHash('$2b$04$new', later);
    expect(user.passwordHash).toBe('$2b$04$new');
    expect(user.updatedAt).toEqual(new Date('2026-10-08T10:00:00Z'));
    expect(user.pullDomainEvents().map((e) => e.eventType)).toEqual([IdentityEventTypes.USER_PASSWORD_CHANGED]);
  });

  it('never puts the phone or password hash in event payloads', () => {
    const user = make();
    user.deactivate(clock);
    user.activate(clock);
    user.replacePasswordHash('$2b$04$secret-hash', clock);
    const serialized = JSON.stringify(user.pullDomainEvents());
    expect(serialized).not.toContain('secret-hash');
    expect(serialized).not.toContain('2010123');
    expect(serialized).not.toContain('passwordHash');
  });
});
