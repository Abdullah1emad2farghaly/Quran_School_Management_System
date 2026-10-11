import { newUuid, type Clock } from '../../../00-shared-kernel/public';
import { geographyError } from '../errors/geography-errors';
import { isGeographyCode } from '../value-objects/geography-code';
import {
  PARENT_LEVEL,
  isCenterKind,
  isGeographyLevel,
  isGeographyStatus,
  type CenterKind,
  type GeographyLevel,
  type GeographyStatus,
} from '../value-objects/geography-level';
import { normalizeGeographyName } from '../value-objects/geography-name';

export interface GeographyNodeSnapshot {
  readonly id: string;
  readonly level: GeographyLevel;
  readonly code: string;
  readonly name: string;
  readonly status: GeographyStatus;
  /** Id of the parent node (`null` for a country). */
  readonly parentId: string | null;
  /** Only for the CENTER level. */
  readonly kind: CenterKind | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * One node of the geography hierarchy. Global reference data: it is NOT owned by an organization (several organizations
 * can have schools in the same village). Only the approved fields exist; there is no rename, status transition or delete.
 */
export class GeographyNode {
  private constructor(private readonly state: GeographyNodeSnapshot) {}

  static create(input: {
    level: GeographyLevel;
    name: string;
    code: string;
    parentId: string | null;
    kind?: CenterKind;
    clock: Clock;
    id?: string;
  }): GeographyNode {
    GeographyNode.assertShape(input.level, input.code, input.parentId, input.kind ?? null);
    const now = input.clock.now();
    return new GeographyNode({
      id: input.id ?? newUuid(),
      level: input.level,
      code: input.code,
      name: normalizeGeographyName(input.name),
      status: 'ACTIVE',
      parentId: input.parentId,
      kind: input.level === 'CENTER' ? (input.kind ?? null) : null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Loads a stored node; stored data that breaks the invariants is rejected, never trusted. */
  static rehydrate(snapshot: GeographyNodeSnapshot): GeographyNode {
    if (!isGeographyStatus(snapshot.status)) throw new Error('Corrupt geography record');
    GeographyNode.assertShape(snapshot.level, snapshot.code, snapshot.parentId, snapshot.kind);
    return new GeographyNode(snapshot);
  }

  private static assertShape(level: GeographyLevel, code: string, parentId: string | null, kind: CenterKind | null): void {
    if (!isGeographyLevel(level) || !isGeographyCode(level, code)) throw new RangeError('Invalid geography code');
    const needsParent = PARENT_LEVEL[level] !== null;
    if (needsParent !== (parentId !== null)) throw geographyError('GEOGRAPHY_PARENT_NOT_FOUND');
    if (level === 'CENTER' ? !isCenterKind(kind) : kind !== null) throw new RangeError('Invalid center kind');
  }

  get id(): string {
    return this.state.id;
  }
  get level(): GeographyLevel {
    return this.state.level;
  }
  get code(): string {
    return this.state.code;
  }
  get name(): string {
    return this.state.name;
  }
  get status(): GeographyStatus {
    return this.state.status;
  }
  get parentId(): string | null {
    return this.state.parentId;
  }
  get kind(): CenterKind | null {
    return this.state.kind;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }
}
