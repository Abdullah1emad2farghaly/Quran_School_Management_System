/** Base class for objects with identity. Equality is by type and id. */
export abstract class Entity<TId extends string | number = string> {
  protected constructor(public readonly id: TId) {}

  equals(other: unknown): boolean {
    if (this === other) return true;
    if (!(other instanceof Entity)) return false;
    return other.constructor === this.constructor && other.id === this.id;
  }
}
