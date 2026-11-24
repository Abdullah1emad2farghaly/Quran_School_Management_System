/** One event of a group's authoritative history that decides who teaches it (the first teacher at creation, every TEACHER_CHANGED, the archiving). */
export interface TeachingEvent {
  readonly action: 'CREATED' | 'TEACHER_CHANGED' | 'ARCHIVED';
  readonly occurredAt: Date;
  /** The Teacher the group has from this event on (CREATED / TEACHER_CHANGED); not used by ARCHIVED. */
  readonly newTeacherId: string | null;
}

/** A continuous time a Teacher taught a group: from `from` (inclusive) until `to` (exclusive); `to` is null while the Teacher still teaches it. */
export interface TeachingStint {
  readonly from: Date;
  readonly to: Date | null;
}

/**
 * The stints in which `teacherId` taught a group, derived ONLY from the group's authoritative history (never from who owns the group now): a stint starts when the history gives the group to that Teacher
 * (CREATED with that first Teacher, or TEACHER_CHANGED to them), and ends when the group goes to someone else or to nobody (TEACHER_CHANGED) or is archived (a group that is archived is not taught any more).
 * Events are taken in the order given (the history's own sequence); a stint of zero length (given and taken away at the same instant) is dropped. A Teacher can have several stints in the same group
 * (they leave and come back).
 */
export function teachingStints(events: readonly TeachingEvent[], teacherId: string): TeachingStint[] {
  const stints: TeachingStint[] = [];
  let startedAt: Date | null = null;
  const close = (at: Date): void => {
    if (startedAt !== null && at.getTime() > startedAt.getTime()) stints.push({ from: startedAt, to: at });
    startedAt = null;
  };
  for (const event of events) {
    if (event.action === 'ARCHIVED') {
      close(event.occurredAt);
      continue;
    }
    const teaches = event.newTeacherId === teacherId;
    if (teaches && startedAt === null) startedAt = event.occurredAt;
    else if (!teaches) close(event.occurredAt);
  }
  if (startedAt !== null) stints.push({ from: startedAt, to: null });
  return stints;
}

/** The part of a stint that lies inside the half-open range [`from`, `toExclusive`) (either bound optional), or undefined when none of it does. */
export function clipStint(stint: TeachingStint, range: { readonly from?: Date; readonly toExclusive?: Date }): TeachingStint | undefined {
  const from = range.from !== undefined && range.from.getTime() > stint.from.getTime() ? range.from : stint.from;
  const ends = [stint.to, range.toExclusive].filter((d): d is Date => d !== null && d !== undefined);
  const to = ends.length === 0 ? null : new Date(Math.min(...ends.map((d) => d.getTime())));
  if (to !== null && to.getTime() <= from.getTime()) return undefined;
  return { from, to };
}
