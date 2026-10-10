/**
 * Management scope and reporting scope are SEPARATE (Master Specification §20): reporting scope never grants
 * management permissions, and management scope never implies reporting access. A permission declares which
 * kind of scope it needs, and the engine only ever asks about THAT kind.
 */
export const SCOPE_KINDS = ['MANAGEMENT', 'REPORTING'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

/** `UNSCOPED` = the permission is not tied to a place (the caller must state this explicitly when registering it). */
export const POLICY_SCOPES = [...SCOPE_KINDS, 'UNSCOPED'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && (SCOPE_KINDS as readonly string[]).includes(value);
}

export function isPolicyScope(value: unknown): value is PolicyScope {
  return typeof value === 'string' && (POLICY_SCOPES as readonly string[]).includes(value);
}
