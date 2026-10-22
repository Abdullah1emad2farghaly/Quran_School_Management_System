import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { groupError } from '../errors/group-errors';
import { GROUP_AGGREGATE_TYPE, GroupEventTypes, type GroupEventPayload } from '../events/group-events';
import { groupNameKey, type GroupStatus, type LearningMode, type Progression } from '../value-objects/group-settings';
import type { GroupHistoryEntry } from './group-history-entry';

export interface GroupSnapshot {
  readonly id: string;
  /** The ONE school of the group. Never changes. */
  readonly schoolId: string;
  readonly organizationId: string;
  /** Already normalized (see `normalizeGroupName`). */
  readonly name: string;
  /** `groupNameKey(name)`: what the unique-name rule among ACTIVE groups of the school compares. */
  readonly nameKey: string;
  /** At most ONE Teacher (Module 18); null while the group has none. Kept on an ARCHIVED group for the history only. */
  readonly teacherId: string | null;
  readonly learningMode: LearningMode;
  readonly progression: Progression;
  /** 1-114. The surah names belong to Module 21. */
  readonly startingSurah: number;
  readonly status: GroupStatus;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

export interface GroupSettingsChange {
  name?: string | undefined;
  learningMode?: LearningMode | undefined;
  progression?: Progression | undefined;
  startingSurah?: number | undefined;
}

/**
 * The Group entity (Master Specification §40-§43). It owns the name, the Teacher reference, the learning mode, the progression direction and the
 * starting surah. It does NOT own its students (the assignment records do) and it has no schedule (Module 23). Every change records a history
 * entry and a domain event.
 */
export class Group extends AggregateRoot<string> {
  private pendingHistory: GroupHistoryEntry[] = [];

  private constructor(private state: GroupSnapshot) {
    super(state.id);
  }

  static register(input: {
    schoolId: string;
    organizationId: string;
    name: string;
    teacherId: string | null;
    learningMode: LearningMode;
    progression: Progression;
    startingSurah: number;
    createdBy: string;
    clock: Clock;
    id?: string;
  }): Group {
    const now = input.clock.now();
    const group = new Group({
      id: input.id ?? newUuid(),
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      name: input.name,
      nameKey: groupNameKey(input.name),
      teacherId: input.teacherId,
      learningMode: input.learningMode,
      progression: input.progression,
      startingSurah: input.startingSurah,
      status: 'ACTIVE',
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    group.recordEvent(GroupEventTypes.GROUP_CREATED, input.createdBy, input.clock);
    group.recordHistory('CREATED', input.createdBy, input.clock, {
      newName: input.name,
      newTeacherId: input.teacherId,
      newLearningMode: input.learningMode,
      newProgression: input.progression,
      newStartingSurah: input.startingSurah,
    });
    return group;
  }

  static rehydrate(snapshot: GroupSnapshot): Group {
    return new Group(snapshot);
  }

  get snapshot(): GroupSnapshot {
    return this.state;
  }
  get status(): GroupStatus {
    return this.state.status;
  }
  get version(): number {
    return this.state.version;
  }

  pullHistory(): GroupHistoryEntry[] {
    const entries = this.pendingHistory;
    this.pendingHistory = [];
    return entries;
  }

  /** Changes the name, learning mode, progression and/or starting surah; returns the attributes that really changed (empty: nothing recorded). */
  updateSettings(change: GroupSettingsChange, actorId: string, clock: Clock): string[] {
    if (this.state.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
    const prev = this.state;
    let next = this.state;
    const changed: string[] = [];
    if (change.name !== undefined && change.name !== prev.name) {
      next = { ...next, name: change.name, nameKey: groupNameKey(change.name) };
      changed.push('NAME');
    }
    if (change.learningMode !== undefined && change.learningMode !== prev.learningMode) {
      next = { ...next, learningMode: change.learningMode };
      changed.push('LEARNING_MODE');
    }
    if (change.progression !== undefined && change.progression !== prev.progression) {
      next = { ...next, progression: change.progression };
      changed.push('PROGRESSION');
    }
    if (change.startingSurah !== undefined && change.startingSurah !== prev.startingSurah) {
      next = { ...next, startingSurah: change.startingSurah };
      changed.push('STARTING_SURAH');
    }
    if (changed.length === 0) return changed;
    this.state = { ...next, updatedAt: clock.now() };
    this.recordEvent(GroupEventTypes.GROUP_UPDATED, actorId, clock, { changedFields: changed });
    const has = (f: string) => changed.includes(f);
    this.recordHistory('UPDATED', actorId, clock, {
      previousName: has('NAME') ? prev.name : null,
      newName: has('NAME') ? this.state.name : null,
      previousLearningMode: has('LEARNING_MODE') ? prev.learningMode : null,
      newLearningMode: has('LEARNING_MODE') ? this.state.learningMode : null,
      previousProgression: has('PROGRESSION') ? prev.progression : null,
      newProgression: has('PROGRESSION') ? this.state.progression : null,
      previousStartingSurah: has('STARTING_SURAH') ? prev.startingSurah : null,
      newStartingSurah: has('STARTING_SURAH') ? this.state.startingSurah : null,
    });
    return changed;
  }

  /** Assigns, changes or removes (null) the Teacher. Returns false when nothing changes. */
  setTeacher(teacherId: string | null, actorId: string, clock: Clock): boolean {
    if (this.state.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
    if (teacherId === this.state.teacherId) return false;
    const previousTeacherId = this.state.teacherId;
    this.state = { ...this.state, teacherId, updatedAt: clock.now() };
    this.recordEvent(GroupEventTypes.GROUP_TEACHER_CHANGED, actorId, clock, { previousTeacherId });
    this.recordHistory('TEACHER_CHANGED', actorId, clock, { previousTeacherId, newTeacherId: teacherId });
    return true;
  }

  /** ARCHIVED is final. The service ends every current student assignment in the same transaction. */
  archive(actorId: string, reason: string | null, clock: Clock): void {
    if (this.state.status === 'ARCHIVED') throw groupError('GROUP_ARCHIVED');
    this.state = { ...this.state, status: 'ARCHIVED', updatedAt: clock.now() };
    this.recordEvent(GroupEventTypes.GROUP_ARCHIVED, actorId, clock);
    this.recordHistory('ARCHIVED', actorId, clock, {}, reason);
  }

  private recordEvent(eventType: (typeof GroupEventTypes)[keyof typeof GroupEventTypes], actorId: string, clock: Clock, extra: Partial<GroupEventPayload> = {}): void {
    this.addDomainEvent(
      createDomainEvent<GroupEventPayload>(
        {
          eventType,
          aggregateType: GROUP_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { groupId: this.id, schoolId: this.state.schoolId, organizationId: this.state.organizationId, actorId, status: this.state.status, teacherId: this.state.teacherId, ...extra },
        },
        clock,
      ),
    );
  }

  private recordHistory(action: GroupHistoryEntry['action'], actorId: string, clock: Clock, fields: Partial<Omit<GroupHistoryEntry, 'id' | 'groupId' | 'action' | 'actorId' | 'occurredAt' | 'reason'>> = {}, reason: string | null = null): void {
    this.pendingHistory.push({
      id: newUuid(),
      groupId: this.id,
      action,
      actorId,
      occurredAt: clock.now(),
      reason,
      previousName: fields.previousName ?? null,
      newName: fields.newName ?? null,
      previousTeacherId: fields.previousTeacherId ?? null,
      newTeacherId: fields.newTeacherId ?? null,
      previousLearningMode: fields.previousLearningMode ?? null,
      newLearningMode: fields.newLearningMode ?? null,
      previousProgression: fields.previousProgression ?? null,
      newProgression: fields.newProgression ?? null,
      previousStartingSurah: fields.previousStartingSurah ?? null,
      newStartingSurah: fields.newStartingSurah ?? null,
    });
  }
}
