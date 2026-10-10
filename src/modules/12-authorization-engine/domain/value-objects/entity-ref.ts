/**
 * A reference to something owned by another module (a school, a geography node, a group, a session...).
 * The engine does not know what the types mean and never invents organizational mappings: it only passes the
 * reference to the resolver that the OWNING module registered.
 */
export interface EntityRef {
  /** UPPER_SNAKE_CASE type name chosen by the owning module, for example `SCHOOL`. */
  readonly type: string;
  /** Identifier of the entity (a UUID in practice). Printable ASCII, no spaces, at most 64 characters. */
  readonly id: string;
}

/** Where an operation is performed (checked against the caller's scope). */
export type ScopeTarget = EntityRef;
/** The thing being acted on (checked for ownership). */
export type ResourceRef = EntityRef;

const TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const ID_PATTERN = /^[\x21-\x7E]{1,64}$/;

export function isEntityType(value: unknown): value is string {
  return typeof value === 'string' && TYPE_PATTERN.test(value);
}

export function isEntityRef(value: unknown): value is EntityRef {
  if (typeof value !== 'object' || value === null) return false;
  const { type, id } = value as { type?: unknown; id?: unknown };
  return isEntityType(type) && typeof id === 'string' && ID_PATTERN.test(id);
}
