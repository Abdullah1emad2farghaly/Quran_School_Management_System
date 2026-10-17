import type { Router } from 'express';
import { HTTP_METHODS, joinPaths, toOpenApiPath, type HttpMethod } from '../../../src/modules/04-validation-api/public';

export interface DiscoveredRoute {
  readonly method: HttpMethod;
  /** Full path below the router's mount point, OpenAPI style ("/schools/{id}/approve"). */
  readonly path: string;
}

/** Thrown when a route cannot be mapped with certainty. The verification must FAIL then, never silently skip a route. */
export class UnmappableRouteError extends Error {
  constructor(message: string) {
    super(`Cannot map route for API documentation: ${message}. Register it with a plain string path on a Router mounted with a plain string path (or extend tests/api-docs/support/route-discovery.ts).`);
    this.name = 'UnmappableRouteError';
  }
}

interface ExpressLayer {
  readonly name?: string;
  readonly route?: { readonly path: unknown; readonly methods: Readonly<Record<string, boolean>> };
  readonly handle: { readonly stack?: readonly ExpressLayer[] } & ((...args: never[]) => unknown);
  readonly regexp: RegExp & { fast_slash?: boolean };
  readonly keys: readonly unknown[];
}

const MOUNT_SOURCE = /^\^((?:\\\/[A-Za-z0-9_.~-]+)+)\\\/\?\(\?=\\\/\|\$\)$/;

/** Decodes the static mount path of a `router.use('/x', ...)` layer from Express 4's compiled regexp. */
function mountPathOf(layer: ExpressLayer): string {
  if (layer.regexp.fast_slash) return '';
  if (layer.keys.length > 0) throw new UnmappableRouteError(`a router is mounted under a parameterized path (${layer.regexp.source})`);
  const match = MOUNT_SOURCE.exec(layer.regexp.source);
  if (!match) throw new UnmappableRouteError(`the mount path ${layer.regexp.source} is not a plain string path`);
  return (match[1] as string).replace(/\\\//g, '/');
}

function walk(stack: readonly ExpressLayer[], prefix: string, into: DiscoveredRoute[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const path = layer.route.path;
      if (typeof path !== 'string') throw new UnmappableRouteError(`route path ${String(path)} is not a plain string`);
      const methods = Object.entries(layer.route.methods).filter(([, enabled]) => enabled).map(([method]) => method);
      for (const method of methods) {
        if (method === '_all') throw new UnmappableRouteError(`${prefix}${path} is registered with all()`);
        if (!(HTTP_METHODS as readonly string[]).includes(method)) throw new UnmappableRouteError(`${prefix}${path} uses the unsupported method ${method.toUpperCase()}`);
        into.push({ method: method as HttpMethod, path: toOpenApiPath(joinPaths(prefix, path)) });
      }
      continue;
    }
    if (Array.isArray(layer.handle.stack)) {
      walk(layer.handle.stack, joinPaths(prefix, mountPathOf(layer) || '/'), into);
      continue;
    }
    // Plain middleware. Only a global one (mounted at "/") is allowed; one mounted at a path could serve requests we cannot see.
    if (!layer.regexp.fast_slash) throw new UnmappableRouteError(`middleware "${layer.name ?? 'anonymous'}" is mounted at ${layer.regexp.source} but is not a Router`);
  }
}

/** Every method + full path served by a router (nested routers and all HTTP methods included), sorted and de-duplicated. */
export function discoverRoutes(router: Router, mountPath = ''): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  walk((router as unknown as { stack: readonly ExpressLayer[] }).stack, mountPath || '/', routes);
  const seen = new Set<string>();
  return routes
    .filter((r) => (seen.has(`${r.method} ${r.path}`) ? false : (seen.add(`${r.method} ${r.path}`), true)))
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

export const routeKey = (r: DiscoveredRoute): string => `${r.method.toUpperCase()} ${r.path}`;
