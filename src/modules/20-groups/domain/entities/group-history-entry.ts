import type { LearningMode, Progression } from '../value-objects/group-settings';

export type GroupHistoryAction = 'CREATED' | 'UPDATED' | 'TEACHER_CHANGED' | 'ARCHIVED';

/**
 * One row of the Group history (Master Specification §65/§68/§103): what changed, who did it, when. Append-only. A `previous*` / `new*` pair is
 * filled only for the attributes that changed (a learning mode or progression change takes effect from `occurredAt` onward and never rewrites
 * anything that happened before it).
 */
export interface GroupHistoryEntry {
  readonly id: string;
  readonly groupId: string;
  readonly action: GroupHistoryAction;
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly previousName: string | null;
  readonly newName: string | null;
  readonly previousTeacherId: string | null;
  readonly newTeacherId: string | null;
  readonly previousLearningMode: LearningMode | null;
  readonly newLearningMode: LearningMode | null;
  readonly previousProgression: Progression | null;
  readonly newProgression: Progression | null;
  readonly previousStartingSurah: number | null;
  readonly newStartingSurah: number | null;
}
