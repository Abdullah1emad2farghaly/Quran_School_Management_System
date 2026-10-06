import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from '../../../01-configuration/public';

export interface RequestContext {
  requestId: string;
  locale: Locale;
  /** Set once the caller is authenticated (identity modules). Used by logs/audits/events. */
  actorUserId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Per-request context carried across async calls without passing it around. */
export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run({ ...ctx }, fn);
  },
  get(): Readonly<RequestContext> | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
  /** Adds data to the current request's context (no-op outside a request). */
  update(partial: Partial<RequestContext>): void {
    const store = storage.getStore();
    if (store) Object.assign(store, partial);
  },
};
