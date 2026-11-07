/**
 * The Teacher's protected-action window (Master Specification §45): from the scheduled start minus `leadMinutes` through the scheduled end, BOTH ENDS INCLUSIVE.
 * It is judged by the scheduled times, never by the session status, so a small delay of the background job that moves a session to COMPLETED changes nothing.
 *
 * `afterEndMinutes` (default 0) is the NARROW, explicit exception approved for Module 29 (Evaluations) only: the window then closes `afterEndMinutes` after the scheduled
 * end (still inclusive). Every other caller leaves it at 0, so the general window is unchanged. The value is validated by `SmartGuard.check` (never above
 * `MAX_AFTER_END_MINUTES`).
 */
export function protectedWindowOf(scheduledStart: Date, scheduledEnd: Date, leadMinutes: number, afterEndMinutes = 0): { opensAt: Date; closesAt: Date } {
  return { opensAt: new Date(scheduledStart.getTime() - leadMinutes * 60_000), closesAt: new Date(scheduledEnd.getTime() + afterEndMinutes * 60_000) };
}

export function isInsideProtectedWindow(now: Date, window: { opensAt: Date; closesAt: Date }): boolean {
  return now.getTime() >= window.opensAt.getTime() && now.getTime() <= window.closesAt.getTime();
}
