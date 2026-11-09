import { businessDateOf } from '../../../00-shared-kernel/public';

/**
 * A subscription month is a calendar month of the BUSINESS zone (Africa/Cairo, Master Specification §71) written `YYYY-MM`. The month of a bulk or individual
 * creation is never chosen by the caller: it is the current month in Africa/Cairo, taken from the server clock. Lexicographic order of `YYYY-MM` is chronological order,
 * which the Oldest-Unpaid Rule and the database indexes rely on.
 */
export const BILLING_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isBillingMonth = (value: unknown): value is string => typeof value === 'string' && BILLING_MONTH_PATTERN.test(value);

/** The current month in Africa/Cairo, e.g. `2026-11`. */
export const currentBillingMonth = (now: Date): string => businessDateOf(now).slice(0, 7);
