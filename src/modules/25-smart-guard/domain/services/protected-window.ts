/**
 * The Teacher's protected-action window (Master Specification §45): from the scheduled start minus `leadMinutes` through the scheduled end, BOTH ENDS INCLUSIVE.
 * It is judged by the scheduled times, never by the session status, so a small delay of the background job that moves a session to COMPLETED changes nothing.
 */
export function protectedWindowOf(scheduledStart: Date, scheduledEnd: Date, leadMinutes: number): { opensAt: Date; closesAt: Date } {
  return { opensAt: new Date(scheduledStart.getTime() - leadMinutes * 60_000), closesAt: scheduledEnd };
}

export function isInsideProtectedWindow(now: Date, window: { opensAt: Date; closesAt: Date }): boolean {
  return now.getTime() >= window.opensAt.getTime() && now.getTime() <= window.closesAt.getTime();
}
