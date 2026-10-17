// OpenAPI building kit (docs/API-DOCUMENTATION.md). Re-exported by the public contract of Module 04.
export * from './types';
export * as schema from './schema';
export { ref } from './schema';
export { listQueryParameters } from './list-query-parameters';
export { buildOpenApiDocument, allErrors, joinPaths, toOpenApiPath, BEARER_SCHEME, type BuildOptions } from './document-builder';
export { apiConventionsMarkdown } from './conventions';
export { publicEndpoint, authenticatedOnly } from './authorization';
