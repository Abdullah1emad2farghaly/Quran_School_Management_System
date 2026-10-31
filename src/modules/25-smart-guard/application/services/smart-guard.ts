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

export interface SmartGuardCheckInput {
  /** The caller's Teacher record id, resolved by the protected module from the verified token (never from the request). */
  readonly teacherId: string;
  readonly sessionId: string;
  /** The GPS reading sent with the action: `{ latitude, longitude, accuracyMeters }`. Anything else is refused. */
  readonly gps: unknown;
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
 *                   by the SCHEDULED times, not by the session status)
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

  private async evaluate(input: SmartGuardCheckInput): Promise<SmartGuardAllowance> {
    const session = await this.sessions.getSession(input.sessionId);

    // Ownership
    if (session.teacherId !== input.teacherId) throw smartGuardError('SMART_GUARD_NOT_SESSION_TEACHER');

    // Correct time: by the scheduled times, both ends inclusive.
    const window = protectedWindowOf(session.scheduledStart, session.scheduledEnd, SESSION_LEAD_MINUTES);
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
