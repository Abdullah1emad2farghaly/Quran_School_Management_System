import { newUuid, type DomainEvent } from '../../../00-shared-kernel/public';
import type { AuditRecord } from '../entities/audit-record';
import { AUDITED_EVENTS } from '../value-objects/audit-catalog';

/** Keys that must never be copied from an event into the audit trail (secrets and contact data). Matched anywhere in the key name, case-insensitively. */
const SENSITIVE_KEY = /(password|passcode|token|otp|secret|hash|nationalid|phone|email|endpoint|credential)/i;
const MAX_JSON_CHARS = 16_000;
const MAX_TEXT = 255;
/** Fields stored in their own columns instead of the `after` snapshot. */
const COLUMN_KEYS = new Set(['actorUserId', 'actorId']);
const PREVIOUS = /^previous([A-Z].*)$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);
const lowerFirst = (s: string): string => (s === '' ? s : s[0]!.toLowerCase() + s.slice(1));

/** Copies a JSON value without sensitive keys; non-JSON values (functions, symbols, bigint) are dropped. Depth is capped so a hostile payload cannot blow the stack. */
function clean(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!SENSITIVE_KEY.test(k)) out[k] = clean(v, depth + 1);
    return out;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

/** Keeps the snapshot within the column size: an oversized one is replaced by a marker (the audit record itself is still written). */
function bounded(snapshot: Record<string, unknown> | null): Record<string, unknown> | null {
  if (snapshot === null || Object.keys(snapshot).length === 0) return null;
  return JSON.stringify(snapshot).length > MAX_JSON_CHARS ? { truncated: true } : snapshot;
}

/**
 * Turns an audited domain event into an audit record. Pure: no database, no clock (the caller supplies `recordedAt`). Returns null for an event that is not in the
 * catalog, so the recorder can never store something nobody approved.
 *  - `before` = the event's `previousX` fields (named `x`); `after` = the other payload fields except the actor (kept in its own column). Sensitive keys never copied.
 *  - actor: the verified caller recorded in the event metadata (request context), else an actor id carried by the payload, else null (system-originated).
 *  - scope: `schoolId` / `organizationId` from the payload; a School or Organization aggregate is its own scope. The recorder completes the organization of a school.
 */
export function buildAuditRecord(event: DomainEvent, recordedAt: Date): AuditRecord | null {
  const entry = AUDITED_EVENTS[event.eventType];
  if (!entry) return null;
  const payload = isRecord(event.payload) ? event.payload : {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(clean(payload) as Record<string, unknown>)) {
    const previous = PREVIOUS.exec(key);
    if (previous) before[lowerFirst(previous[1]!)] = value;
    else if (!COLUMN_KEYS.has(key)) after[key] = value;
  }
  const meta = event.metadata;
  const schoolId = text(payload.schoolId, 36) ?? (event.aggregateType === 'School' ? text(event.aggregateId, 36) : null);
  const organizationId = text(payload.organizationId, 36) ?? (event.aggregateType === 'Organization' ? text(event.aggregateId, 36) : null);
  return {
    id: newUuid(),
    eventId: event.eventId,
    actorUserId: text(meta?.actorUserId, 36) ?? text(payload.actorUserId, 36) ?? text(payload.actorId, 36),
    action: entry.action,
    module: entry.module,
    entityType: text(event.aggregateType, 80) ?? 'Unknown',
    entityId: text(event.aggregateId, 64) ?? '',
    before: bounded(before),
    after: bounded(after),
    ipAddress: text(meta?.ipAddress, 64),
    userAgent: text(meta?.userAgent, 255),
    requestId: text(meta?.requestId, 64),
    organizationId,
    schoolId,
    occurredAt: event.occurredAt,
    recordedAt,
  };
}
