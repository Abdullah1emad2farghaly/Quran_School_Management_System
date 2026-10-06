/** pending: waiting (or scheduled for retry) · processed: delivered · dead: gave up after max attempts */
export const OUTBOX_STATUSES = ['pending', 'processed', 'dead'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
