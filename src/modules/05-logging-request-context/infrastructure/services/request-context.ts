import { AsyncLocalStorage } from 'node:async_hooks';
import type { Locale } from '../../../../config/env';

export interface RequestContext {
  requestId: string;
  locale: Locale;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
