import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { GeographyRepository } from '../../application/ports/geography-repository';
import { GeographyNode, type GeographyNodeSnapshot } from '../../domain/entities/geography-node';
import { geographyError } from '../../domain/errors/geography-errors';
import { PARENT_LEVEL, type CenterKind, type GeographyLevel } from '../../domain/value-objects/geography-level';

/** In-memory repository mirroring the database rules (unique code, unique name under the parent/kind, parent must exist). For tests. */
export class InMemoryGeographyRepository implements GeographyRepository {
  readonly rows = new Map<string, GeographyNodeSnapshot>();
  /** Test helper: flip a node's status (no such operation exists in V1). */
  setStatus(id: string, status: 'ACTIVE' | 'INACTIVE'): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, status });
  }

  private same(a: string, b: string): boolean {
    return a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase();
  }

  async insert(node: GeographyNode, _tx: TransactionContext): Promise<void> {
    const parentLevel = PARENT_LEVEL[node.level];
    if (parentLevel !== null) {
      const parent = this.rows.get(node.parentId ?? '');
      if (!parent || parent.level !== parentLevel) throw geographyError('GEOGRAPHY_PARENT_NOT_FOUND');
    }
    for (const row of this.rows.values()) {
      if (row.level !== node.level) continue;
      const sameCode = row.code === node.code;
      const sameName = row.parentId === node.parentId && row.kind === node.kind && this.same(row.name, node.name);
      if (sameCode || sameName) throw geographyError('GEOGRAPHY_NODE_ALREADY_EXISTS');
    }
    this.rows.set(node.id, {
      id: node.id, level: node.level, code: node.code, name: node.name, status: node.status,
      parentId: node.parentId, kind: node.kind, createdAt: node.createdAt, updatedAt: node.updatedAt,
    });
  }

  async findById(level: GeographyLevel, id: string, _tx?: TransactionContext): Promise<GeographyNode | undefined> {
    const row = this.rows.get(id);
    return row && row.level === level ? GeographyNode.rehydrate(row) : undefined;
  }

  async findByName(level: GeographyLevel, parentId: string | null, name: string, kind: CenterKind | null, _tx?: TransactionContext): Promise<GeographyNode | undefined> {
    const row = [...this.rows.values()].find((r) => r.level === level && r.parentId === parentId && r.kind === kind && this.same(r.name, name));
    return row ? GeographyNode.rehydrate(row) : undefined;
  }

  async listChildren(level: GeographyLevel, parentId: string | null, _tx?: TransactionContext): Promise<GeographyNode[]> {
    return [...this.rows.values()]
      .filter((r) => r.level === level && (parentId === null || r.parentId === parentId))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((r) => GeographyNode.rehydrate(r));
  }

  async nextCodeSequence(level: GeographyLevel, _tx?: TransactionContext): Promise<number> {
    const numbers = [...this.rows.values()].filter((r) => r.level === level).map((r) => Number(r.code.slice(4)));
    return Math.max(0, ...numbers) + 1;
  }
}
