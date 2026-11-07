import { AppError, SystemClock, type Clock } from '../../../00-shared-kernel/public';
import type { Logger } from '../../../05-logging-request-context/public';
import { GPS_MAX_ACCURACY_METERS, SCHOOL_GEOFENCE_RADIUS_METERS, isWithinSchoolGeofence, type SchoolService } from '../../../16-schools/public';
import { SESSION_LEAD_MINUTES, type ClassSessionService } from '../../../24-sessions/public';
import { smartGuardError } from '../../domain/errors/smart-guard-errors';
import { isInsideProtectedWindow, protectedWindowOf } from '../../domain/services/protected-window';
import { readGpsReading } from '../../domain/value-objects/gps-reading';

export interface SmartGuardDeps {
  /** Module 24's public read of a session (scheduled times, school, group, Teacher, status). */
  readonly sessions: Pick<ClassSessionService, 'getSession'>;
  /** Module 16's public read of a school (official GPS, status). */
  readonly schools: Pick<SchoolService, 'findById'>;
  readonly clock?: Clock;
  /** Optional. Only the rejection code and technical identifiers are ever logged: never a GPS coordinate. */
  readonly logger?: Logger;
}

/**
 * The most a protected action may ask the window to stay open after the scheduled end. It exists ONLY for the approved post-completion grace period of Module 29
 * (Evaluations): 15 minutes. A larger value is refused, so no module can widen the window further by mistake.
 */
export const MAX_AFTER_END_MINUTES = 15;

export interface SmartGuardCheckInput {
  /** The caller's Teacher record id, resolved by the protected module from the verified token (never from the request). */
  readonly teacherId: string;
  readonly sessionId: string;
  /** The GPS reading sent with the action: `{ latitude, longitude, accuracyMeters }`. Anything else is refused. */
  readonly gps: unknown;
  /**
   * OPTIONAL, default 0. A NARROW, explicit exception (approved for Module 29 Evaluations only): keeps the time window open this many minutes after the scheduled end
   * (inclusive). Only an action that the approved business rules allow after the session ends passes it; Attendance, Memorization and Revision never do. At most
   * `MAX_AFTER_END_MINUTES`; anything else (negative, fractional, not a number, too large) is a programming error and throws.
   */
  readonly allowAfterEndMinutes?: number;
}

export interface SmartGuardProtectedActionInput {
  /** The caller's Teacher record id. The protected module has ALREADY verified that this Teacher owns the action (for exams: is a currently assigned examiner of the exam). */
  readonly teacherId: string;
  /** The school whose official GPS the action is measured against (loaded by the protected module from its own server-side data, never from the request). */
  readonly schoolId: string;
  readonly gps: unknown;
  /** The action's time window, supplied by the protected module (both ends inclusive). `closesAt: null` means the window has no upper bound. */
  readonly window: { readonly opensAt: Date; readonly closesAt: Date | null };
}

/** What an ALLOWED check tells the protected module. It carries no coordinates. */
export interface SmartGuardAllowance {
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly teacherId: string;
}

/**
 * Smart Guard (Master Specification §50, §101): reusable infrastructure that a protected Teacher action calls AFTER its own authentication, permission, scope and
 * ownership checks. It is stateless (it stores nothing), has no HTTP endpoint, and owns no attendance, memorization, revision or evaluation logic.
 *
 * `check` validates, in the order of §50, and throws an `AppError` with a `SMART_GUARD_*` code at the first failure (it returns only when the action is ALLOWED):
 *   ownership       the caller is the session's Teacher                         SMART_GUARD_NOT_SESSION_TEACHER
 *   correct time    session start - 15 min <= now <= session end (inclusive,    SMART_GUARD_OUTSIDE_SESSION_WINDOW
 *                   by the SCHEDULED times, not by the session status). ONLY an action that passes `allowAfterEndMinutes` (Module 29, <= 15) keeps it open after the end.
 *   GPS reading     present and a valid fix                                     SMART_GUARD_GPS_REQUIRED / SMART_GUARD_GPS_INVALID
 *   distance        <= 50 m from the school's official GPS                      SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE
 *   GPS accuracy    <= 20 m                                                     SMART_GUARD_GPS_ACCURACY_TOO_LOW
 *   business rules  the session is not cancelled; the school is ACTIVE          SMART_GUARD_SESSION_CANCELLED / SMART_GUARD_SCHOOL_NOT_ACTIVE
 * No IP, manual-location or postal fallback exists. Not a protection against GPS spoofing: it checks what the phone reports against the specified limits.
 * An unknown session is the NOT_FOUND of Module 24. Session CANCELLATION is NOT a protected action and never calls this (approved decision).
 */
export class SmartGuard {
  private readonly sessions: SmartGuardDeps['sessions'];
  private readonly schools: SmartGuardDeps['schools'];
  private readonly clock: Clock;
  private readonly logger: Logger | undefined;

  constructor(deps: SmartGuardDeps) {
    this.sessions = deps.sessions;
    this.schools = deps.schools;
    this.clock = deps.clock ?? new SystemClock();
    this.logger = deps.logger;
  }

  async check(input: SmartGuardCheckInput): Promise<SmartGuardAllowance> {
    try {
      return await this.evaluate(input);
    } catch (error) {
      if (error instanceof AppError && error.code.startsWith('SMART_GUARD_')) {
        // Operational trace: the rejection code and technical identifiers only. NEVER the GPS reading, the distance or the school's location.
        this.logger?.info('smart guard rejected a protected action', { code: error.code, sessionId: input.sessionId });
      }
      throw error;
    }
  }

  /**
   * The exam-compatible entry point (approved with Module 30; ADDITIVE, `check` is unchanged for every other module): the same §50 chain for a protected action that is NOT a
   * class session. The protected module verifies ownership and supplies the time window; Smart Guard validates the time window, the GPS reading, the distance (<= 50 m), the
   * accuracy (<= 20 m) and that the school is ACTIVE, with the same `SMART_GUARD_*` codes. It returns nothing: it either allows the action or throws.
   */
  async checkProtectedAction(input: SmartGuardProtectedActionInput): Promise<void> {
    try {
      const now = this.clock.now().getTime();
      const { opensAt, closesAt } = input.window;
      if (now < opensAt.getTime() || (closesAt !== null && now > closesAt.getTime())) {
        throw smartGuardError('SMART_GUARD_OUTSIDE_SESSION_WINDOW', { opensAt: opensAt.toISOString(), closesAt: closesAt === null ? null : closesAt.toISOString() });
      }
      const gps = readGpsReading(input.gps);
      const school = await this.schools.findById(input.schoolId);
      if (!school) throw smartGuardError('SMART_GUARD_SCHOOL_NOT_ACTIVE');
      if (!isWithinSchoolGeofence({ latitude: school.latitude, longitude: school.longitude }, gps)) {
        throw smartGuardError('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', { maxMeters: SCHOOL_GEOFENCE_RADIUS_METERS }, { maxMeters: SCHOOL_GEOFENCE_RADIUS_METERS });
      }
      if (gps.accuracyMeters > GPS_MAX_ACCURACY_METERS) {
        throw smartGuardError('SMART_GUARD_GPS_ACCURACY_TOO_LOW', { maxMeters: GPS_MAX_ACCURACY_METERS }, { maxMeters: GPS_MAX_ACCURACY_METERS });
      }
      if (school.status !== 'ACTIVE') throw smartGuardError('SMART_GUARD_SCHOOL_NOT_ACTIVE');
    } catch (error) {
      if (error instanceof AppError && error.code.startsWith('SMART_GUARD_')) this.logger?.info('smart guard rejected a protected action', { code: error.code, teacherId: input.teacherId });
      throw error;
    }
  }

  private async evaluate(input: SmartGuardCheckInput): Promise<SmartGuardAllowance> {
    const session = await this.sessions.getSession(input.sessionId);

    // Ownership
    if (session.teacherId !== input.teacherId) throw smartGuardError('SMART_GUARD_NOT_SESSION_TEACHER');

    // Correct time: by the scheduled times, both ends inclusive. `allowAfterEndMinutes` is the Module 29 grace exception (default 0: the general window).
    const afterEnd = input.allowAfterEndMinutes ?? 0;
    if (!Number.isInteger(afterEnd) || afterEnd < 0 || afterEnd > MAX_AFTER_END_MINUTES) throw new Error(`allowAfterEndMinutes must be an integer from 0 to ${MAX_AFTER_END_MINUTES}`);
    const window = protectedWindowOf(session.scheduledStart, session.scheduledEnd, SESSION_LEAD_MINUTES, afterEnd);
    if (!isInsideProtectedWindow(this.clock.now(), window)) {
      throw smartGuardError('SMART_GUARD_OUTSIDE_SESSION_WINDOW', { opensAt: window.opensAt.toISOString(), closesAt: window.closesAt.toISOString() });
    }

    // GPS reading (shape only), then distance, then accuracy.
    const gps = readGpsReading(input.gps);
    const school = await this.schools.findById(session.schoolId);
    if (!school) throw smartGuardError('SMART_GUARD_SCHOOL_NOT_ACTIVE');
    if (!isWithinSchoolGeofence({ latitude: school.latitude, longitude: school.longitude }, gps)) {
      throw smartGuardError('SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE', { maxMeters: SCHOOL_GEOFENCE_RADIUS_METERS }, { maxMeters: SCHOOL_GEOFENCE_RADIUS_METERS });
    }
    if (gps.accuracyMeters > GPS_MAX_ACCURACY_METERS) {
      throw smartGuardError('SMART_GUARD_GPS_ACCURACY_TOO_LOW', { maxMeters: GPS_MAX_ACCURACY_METERS }, { maxMeters: GPS_MAX_ACCURACY_METERS });
    }

    // Business rules owned by Smart Guard: nothing else (the protected module owns its own).
    if (session.status === 'CANCELLED') throw smartGuardError('SMART_GUARD_SESSION_CANCELLED');
    if (school.status !== 'ACTIVE') throw smartGuardError('SMART_GUARD_SCHOOL_NOT_ACTIVE');

    return { sessionId: session.id, schoolId: session.schoolId, groupId: session.groupId, teacherId: session.teacherId };
  }
}
