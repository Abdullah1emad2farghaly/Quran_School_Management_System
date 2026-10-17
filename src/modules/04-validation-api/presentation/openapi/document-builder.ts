import type { OpenAPIV3 } from 'openapi-types';
import { apiConventionsMarkdown } from './conventions';
import {
  OpenApiDocumentError,
  type ErrorDoc,
  type MessageLookup,
  type ModuleApiDoc,
  type OpenApiDocument,
  type OperationDoc,
  type SchemaOrRef,
} from './types';

export const BEARER_SCHEME = 'bearerAuth';
const JSON_TYPE = 'application/json';
const EXAMPLE_REQUEST_ID = '5d9c2f4e-7a41-4c0e-9d2b-3e8f1a6b7c10';

export interface BuildOptions {
  readonly modules: readonly ModuleApiDoc[];
  /** The API base path the routers are mounted under ("/api/v1"). */
  readonly basePath: string;
  readonly title: string;
  readonly version: string;
  /** The real localized message catalog: error examples use the real messages and every documented code must exist in it. */
  readonly messages: MessageLookup;
}

/** "/:id/approve" -> "/{id}/approve" */
export const toOpenApiPath = (expressPath: string): string => expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/** Joins a mount path and an operation path; the operation path "/" is the mount path itself. */
export function joinPaths(mountPath: string, path: string): string {
  const joined = `${mountPath}${path === '/' ? '' : path}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

const pathParamNames = (path: string): string[] => [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] as string);

const ERROR_ENVELOPE: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['success', 'error'],
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      required: ['code', 'message', 'locale'],
      properties: {
        code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$', description: 'Stable, language-independent error code.' },
        message: { type: 'string', description: 'Localized message (see Accept-Language).' },
        locale: { type: 'string', enum: ['ar', 'en'] },
        requestId: { type: 'string' },
        details: {
          description:
            'Optional, client-safe data. For validation errors it is an object `{ fields: [...] }` whose entries carry a localized `message`. A few business errors (address validation) send a plain array of `{ field, code }` entries instead (not localized: use `error.message`).',
          oneOf: [
            { type: 'object', properties: { fields: { type: 'array', items: { $ref: '#/components/schemas/FieldError' } } } },
            { type: 'array', items: { $ref: '#/components/schemas/FieldError' } },
          ],
        },
      },
    },
  },
};

const FIELD_ERROR: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['field', 'code'],
  properties: {
    field: { type: 'string', description: 'Dotted path of the offending field or parameter.', example: 'school.name' },
    code: { type: 'string', example: 'REQUIRED_FIELD' },
    message: { type: 'string', example: 'This field is required.' },
  },
};

const PAGINATION_META: OpenAPIV3.SchemaObject = {
  type: 'object',
  required: ['page', 'pageSize', 'total', 'totalPages'],
  properties: {
    page: { type: 'integer', minimum: 1, example: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100, example: 20 },
    total: { type: 'integer', minimum: 0, example: 1 },
    totalPages: { type: 'integer', minimum: 0, example: 1 },
  },
};

const COMPONENT_HEADERS: Record<string, OpenAPIV3.HeaderObject> = {
  XRequestId: { description: 'The request id (echoed from the request or generated).', schema: { type: 'string' } },
  ContentLanguage: { description: 'The locale of the localized messages (ar or en).', schema: { type: 'string', enum: ['ar', 'en'] } },
  RetryAfter: { description: 'Seconds to wait before retrying.', required: true, schema: { type: 'integer', minimum: 1 } },
  CacheControl: { description: 'Always `no-store` on this operation (tokens and one-time secrets must never be cached).', required: true, schema: { type: 'string', enum: ['no-store'] } },
};

const COMPONENT_PARAMETERS: Record<string, OpenAPIV3.ParameterObject> = {
  AcceptLanguage: {
    name: 'Accept-Language',
    in: 'header',
    required: false,
    description: 'Preferred language of messages: `ar` or `en`. Defaults to the server default.',
    schema: { type: 'string', example: 'en' },
  },
  RequestId: {
    name: 'X-Request-Id',
    in: 'header',
    required: false,
    description: 'Optional correlation id (8–64 characters: letters, digits, `.`, `_`, `-`). Echoed in the answer.',
    schema: { type: 'string', example: EXAMPLE_REQUEST_ID },
  },
};

const BASE_HEADERS = { 'X-Request-Id': { $ref: '#/components/headers/XRequestId' }, 'Content-Language': { $ref: '#/components/headers/ContentLanguage' } };

/** Standard errors every operation of this shape can answer, added automatically (module-specific ones come from `errors`). */
function standardErrors(op: OperationDoc): ErrorDoc[] {
  const list: ErrorDoc[] = [];
  const hasBody = op.request !== undefined;
  const hasInput = hasBody || Object.keys(op.pathParams ?? {}).length > 0 || (op.query ?? []).length > 0;
  if (hasInput) list.push({ status: 400, codes: hasBody ? ['VALIDATION_FAILED', 'INVALID_JSON'] : ['VALIDATION_FAILED'] });
  if (hasBody) list.push({ status: 413, codes: ['PAYLOAD_TOO_LARGE'] });
  if (op.authorization.authentication !== 'none') {
    list.push({ status: 401, codes: ['AUTHENTICATION_REQUIRED', 'ACCESS_TOKEN_INVALID', 'ACCESS_TOKEN_EXPIRED', 'SESSION_REVOKED'] });
    list.push({ status: 403, codes: ['ACCOUNT_INACTIVE'] });
  }
  if (op.rateLimited) list.push({ status: 429, codes: ['RATE_LIMITED'] });
  list.push({ status: 500, codes: ['INTERNAL_ERROR'] });
  return list;
}

/** Declared + automatic errors, merged per status (codes unioned, order kept). */
export function allErrors(op: OperationDoc): ErrorDoc[] {
  const byStatus = new Map<number, { codes: string[]; description?: string; fields?: ErrorDoc['fields'] }>();
  for (const e of [...standardErrors(op), ...(op.errors ?? [])]) {
    const entry = byStatus.get(e.status) ?? { codes: [] };
    for (const c of e.codes) if (!entry.codes.includes(c)) entry.codes.push(c);
    if (e.description) entry.description = e.description;
    if (e.fields) entry.fields = e.fields;
    byStatus.set(e.status, entry);
  }
  return [...byStatus.entries()].sort(([a], [b]) => a - b).map(([status, v]) => ({ status, codes: v.codes, ...(v.description ? { description: v.description } : {}), ...(v.fields ? { fields: v.fields } : {}) }));
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Invalid input',
  401: 'Not authenticated',
  403: 'Not allowed',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  422: 'Business rule violation',
  429: 'Too many requests',
  500: 'Internal error',
};

function defaultFields(op: OperationDoc): { field: string; code: string }[] {
  const schema = op.request?.schema as OpenAPIV3.SchemaObject | undefined;
  const required = schema?.required?.[0];
  if (required) return [{ field: required, code: 'REQUIRED_FIELD' }];
  const param = Object.keys(op.pathParams ?? {})[0];
  if (param) return [{ field: param, code: 'INVALID_VALUE' }];
  const q = op.query?.[0]?.name;
  return [{ field: q ?? 'page', code: 'INVALID_VALUE' }];
}

function errorResponse(op: OperationDoc, error: ErrorDoc, messages: MessageLookup): OpenAPIV3.ResponseObject {
  const examples: Record<string, OpenAPIV3.ExampleObject> = {};
  for (const code of error.codes) {
    const details = code === 'VALIDATION_FAILED' ? { fields: (error.fields ?? defaultFields(op)).map((f) => ({ field: f.field, code: f.code, message: messages.message(f.code, 'en') })) } : undefined;
    examples[code] = {
      summary: code,
      value: { success: false, error: { code, message: messages.message(code, 'en'), locale: 'en', requestId: EXAMPLE_REQUEST_ID, ...(details ? { details } : {}) } },
    };
  }
  return {
    description: `${STATUS_TEXT[error.status] ?? 'Error'}. ${error.description ?? ''} Codes: ${error.codes.map((c) => `\`${c}\``).join(', ')}.`.replace('.  ', '. '),
    headers: { ...BASE_HEADERS, ...(error.status === 429 ? { 'Retry-After': { $ref: '#/components/headers/RetryAfter' } } : {}) },
    content: { [JSON_TYPE]: { schema: { $ref: '#/components/schemas/ErrorEnvelope' }, examples } },
  };
}

function successResponse(op: OperationDoc): OpenAPIV3.ResponseObject {
  const s = op.success;
  const headers = { ...BASE_HEADERS, ...(s.noStore ? { 'Cache-Control': { $ref: '#/components/headers/CacheControl' } } : {}) };
  if (s.status === 204) return { description: s.description, headers };
  const dataSchema: SchemaOrRef = s.paginated ? { type: 'array', items: s.data as SchemaOrRef } : (s.data as SchemaOrRef);
  const schema: OpenAPIV3.SchemaObject = {
    type: 'object',
    required: s.paginated ? ['success', 'data', 'meta'] : ['success', 'data'],
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataSchema,
      ...(s.paginated ? { meta: { $ref: '#/components/schemas/PaginationMeta' } } : {}),
      requestId: { type: 'string' },
    },
  };
  const exampleData = s.paginated ? [s.example] : s.example;
  return {
    description: s.description,
    headers,
    content: {
      [JSON_TYPE]: {
        schema,
        examples: {
          success: {
            summary: 'Success',
            value: { success: true, data: exampleData, ...(s.paginated ? { meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : {}), requestId: EXAMPLE_REQUEST_ID },
          },
        },
      },
    },
  };
}

function authorizationMarkdown(op: OperationDoc, fullPath: string): string {
  const a = op.authorization;
  const authentication = { none: 'none (public endpoint)', optional: 'optional (a Bearer token may be sent; when sent it is validated)', required: 'required (Bearer JWT)' }[a.authentication];
  return [
    `**Full path:** \`${op.method.toUpperCase()} ${fullPath}\``,
    '',
    '**Authorization**',
    `- Authentication: ${authentication}`,
    `- Roles: ${a.roles.length > 0 ? a.roles.map((r) => `\`${r}\``).join(', ') : 'no role requirement'}`,
    `- Scope: ${a.scope}`,
    `- Enforcement: ${a.enforcement}`,
    `- Permission id: ${a.permissionId ? `\`${a.permissionId}\`` : 'none yet (permission-registry entry deferred, D-1/D-2)'}`,
    `- Decision status: ${a.decision}${a.reference ? ` (${a.reference})` : ''}`,
  ].join('\n');
}

function securityOf(op: OperationDoc): OpenAPIV3.SecurityRequirementObject[] {
  switch (op.authorization.authentication) {
    case 'required':
      return [{ [BEARER_SCHEME]: [] }];
    case 'optional':
      return [{}, { [BEARER_SCHEME]: [] }];
    case 'none':
      return [];
  }
}

function buildOperation(mod: ModuleApiDoc, op: OperationDoc, fullPath: string, messages: MessageLookup): OpenAPIV3.OperationObject {
  const parameters: (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[] = [
    ...pathParamNames(op.path).map((name): OpenAPIV3.ParameterObject => {
      const doc = op.pathParams?.[name];
      return { name, in: 'path', required: true, description: doc?.description ?? name, schema: doc?.schema ?? { type: 'string', format: 'uuid' }, example: doc?.example };
    }),
    ...(op.query ?? []),
    { $ref: '#/components/parameters/AcceptLanguage' },
    { $ref: '#/components/parameters/RequestId' },
  ];
  const responses: OpenAPIV3.ResponsesObject = { [String(op.success.status)]: successResponse(op) };
  for (const error of allErrors(op)) {
    const custom = op.customResponses?.[error.status];
    if (!custom) responses[String(error.status)] = errorResponse(op, error, messages);
  }
  for (const [status, custom] of Object.entries(op.customResponses ?? {})) {
    responses[status] = {
      description: custom.description,
      headers: BASE_HEADERS,
      content: { [JSON_TYPE]: { schema: custom.schema, examples: { example: { summary: 'Example', value: custom.example } } } },
    };
  }
  return {
    operationId: op.operationId,
    summary: op.summary,
    description: `${op.description}\n\n${authorizationMarkdown(op, fullPath)}`,
    tags: [mod.tag.name],
    security: securityOf(op),
    parameters,
    ...(op.request
      ? { requestBody: { required: true, description: op.request.description, content: { [JSON_TYPE]: { schema: op.request.schema, examples: { ...op.request.examples } } } } }
      : {}),
    responses,
    ...({ 'x-module': mod.moduleId, 'x-full-path': fullPath, 'x-authorization': op.authorization } as Record<string, unknown>),
  };
}

/** Collects every problem of one contract that can be found without assembling the whole document. */
function checkOperation(mod: ModuleApiDoc, op: OperationDoc, messages: MessageLookup, problems: string[]): void {
  const where = `${mod.moduleId} ${op.method.toUpperCase()} ${op.path} (${op.operationId})`;
  const declared = Object.keys(op.pathParams ?? {});
  const inPath = pathParamNames(op.path);
  for (const name of inPath) if (!declared.includes(name)) problems.push(`${where}: path parameter "${name}" is not documented in pathParams`);
  for (const name of declared) if (!inPath.includes(name)) problems.push(`${where}: pathParams documents "${name}" but the path has no such parameter`);
  if (op.summary.trim() === '' || op.description.trim() === '') problems.push(`${where}: summary and description are required`);
  if (op.success.status === 204 ? op.success.data !== undefined : op.success.data === undefined) problems.push(`${where}: ${op.success.status === 204 ? '204 must not declare data' : 'success.data is required'}`);
  if (op.success.status !== 204 && op.success.example === undefined) problems.push(`${where}: success.example is required`);
  if (op.request && Object.keys(op.request.examples).length === 0) problems.push(`${where}: at least one request example is required`);
  if (op.authorization.authentication === 'none' && op.authorization.roles.length > 0) problems.push(`${where}: a public operation cannot require roles`);
  for (const error of allErrors(op)) {
    for (const code of error.codes) if (!messages.has(code)) problems.push(`${where}: documented error code ${code} (${error.status}) is not in the message catalog`);
  }
  for (const status of Object.keys(op.customResponses ?? {})) {
    if (Number(status) === op.success.status) problems.push(`${where}: customResponses cannot replace the success status ${status}`);
  }
}

/**
 * Assembles the single OpenAPI 3.0 document from the module contracts. Pure and deterministic. Throws `OpenApiDocumentError`
 * listing EVERY problem (duplicate routes or operation ids, undocumented path parameters, unknown error codes...).
 */
export function buildOpenApiDocument(options: BuildOptions): OpenApiDocument {
  const problems: string[] = [];
  const paths: OpenAPIV3.PathsObject = {};
  const operationIds = new Set<string>();
  const schemas: Record<string, OpenAPIV3.SchemaObject> = { ErrorEnvelope: ERROR_ENVELOPE, FieldError: FIELD_ERROR, PaginationMeta: PAGINATION_META };
  const tags: OpenAPIV3.TagObject[] = [];
  const moduleIds = new Set<string>();

  for (const mod of options.modules) {
    if (moduleIds.has(mod.moduleId + mod.mountPath)) problems.push(`module ${mod.moduleId} (${mod.mountPath}) is registered twice`);
    moduleIds.add(mod.moduleId + mod.mountPath);
    if (!tags.some((t) => t.name === mod.tag.name)) tags.push({ name: mod.tag.name, description: mod.tag.description });
    for (const [name, schema] of Object.entries(mod.schemas ?? {})) {
      if (schemas[name]) problems.push(`${mod.moduleId}: component schema "${name}" is defined twice`);
      schemas[name] = schema;
    }
    for (const op of mod.operations) {
      checkOperation(mod, op, options.messages, problems);
      if (operationIds.has(op.operationId)) problems.push(`operationId "${op.operationId}" is used twice`);
      operationIds.add(op.operationId);
      const fullPath = joinPaths(mod.mountPath, op.path);
      const openApiPath = toOpenApiPath(fullPath);
      const item = (paths[openApiPath] ??= {});
      if (item[op.method]) {
        problems.push(`${op.method.toUpperCase()} ${fullPath} is documented twice`);
        continue;
      }
      // The served `paths` are relative to the server URL (`basePath`); the full path is kept in `x-full-path`.
      item[op.method] = buildOperation(mod, op, `${options.basePath}${openApiPath}`, options.messages);
    }
  }
  if (problems.length > 0) throw new OpenApiDocumentError(problems);

  return {
    openapi: '3.0.3',
    info: { title: options.title, version: options.version, description: apiConventionsMarkdown(options.basePath) },
    servers: [{ url: options.basePath, description: 'This server (relative URL: works on any host and port)' }],
    tags,
    paths,
    components: {
      schemas,
      parameters: COMPONENT_PARAMETERS,
      headers: COMPONENT_HEADERS,
      securitySchemes: {
        [BEARER_SCHEME]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token from `POST /auth/login` or `POST /auth/refresh`. Paste only the token; Swagger UI adds the `Bearer` prefix.',
        },
      },
    },
  };
}
