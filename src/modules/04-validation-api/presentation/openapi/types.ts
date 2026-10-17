import type { OpenAPIV3 } from 'openapi-types';

/**
 * Typed building blocks of the QSMS OpenAPI contracts (docs/API-DOCUMENTATION.md).
 * Every module with HTTP endpoints exports ONE `ModuleApiDoc`; the composition root assembles them into the served document.
 */
export type SchemaObject = OpenAPIV3.SchemaObject;
export type SchemaOrRef = OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
export type ParameterObject = OpenAPIV3.ParameterObject;

export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** none = public; optional = a token may be sent (and is then validated); required = a valid access token is mandatory. */
export type AuthenticationMode = 'none' | 'optional' | 'required';

/** The decision status copied from docs/AUTHORIZATION-MATRIX.md; documentation never approves anything by itself. */
export type AuthorizationDecision = 'NOT_APPLICABLE' | 'APPROVED' | 'PROVISIONAL';

export interface AuthorizationDoc {
  readonly authentication: AuthenticationMode;
  /** Roles that may perform the operation. Empty = no role requirement beyond the authentication mode. */
  readonly roles: readonly string[];
  /** The approved scope in plain words ("None" when there is none). */
  readonly scope: string;
  /** How the rule is enforced today (never invented: it must match the code and docs/AUTHORIZATION-MATRIX.md). */
  readonly enforcement: string;
  /** Permission-registry id. `null` while the permission entry is deferred (D-1/D-2). */
  readonly permissionId: string | null;
  readonly decision: AuthorizationDecision;
  /** Where the rule comes from (Master Specification section or project document). */
  readonly reference?: string;
}

export interface FieldErrorExample {
  readonly field: string;
  readonly code: string;
}

export interface ErrorDoc {
  readonly status: number;
  /** Every stable error code this operation can answer with this status. Each must exist in the message catalog. */
  readonly codes: readonly string[];
  readonly description?: string;
  /** Example `details.fields` for VALIDATION_FAILED (defaults to the first required request field or parameter). */
  readonly fields?: readonly FieldErrorExample[];
}

export interface SuccessDoc {
  readonly status: 200 | 201 | 204;
  readonly description: string;
  /** Schema of `data` (the item schema when `paginated`). Absent for 204. */
  readonly data?: SchemaOrRef;
  /** An example of `data` (of ONE item when `paginated`). */
  readonly example?: unknown;
  readonly paginated?: boolean;
  /** Documents `Cache-Control: no-store` (token and OTP answers). */
  readonly noStore?: boolean;
}

export interface RequestDoc {
  readonly description: string;
  readonly schema: SchemaOrRef;
  readonly examples: Readonly<Record<string, { readonly summary: string; readonly value: unknown }>>;
}

export interface PathParamDoc {
  readonly description: string;
  readonly example: string;
  readonly schema?: SchemaObject;
}

/** A response that is not the standard error envelope (for example the readiness 503). */
export interface CustomResponseDoc {
  readonly description: string;
  readonly schema: SchemaOrRef;
  readonly example: unknown;
}

export interface OperationDoc {
  readonly method: HttpMethod;
  /** Express-style path relative to the module mount path ("/" = the mount path itself, "/:id/approve"). */
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly authorization: AuthorizationDoc;
  readonly pathParams?: Readonly<Record<string, PathParamDoc>>;
  readonly query?: readonly ParameterObject[];
  readonly request?: RequestDoc;
  readonly success: SuccessDoc;
  /** Module-specific errors. Standard ones (validation, authentication, payload size, rate limit, internal) are added automatically. */
  readonly errors?: readonly ErrorDoc[];
  /** The operation sits behind the public-submission abuse limiter (adds 429 RATE_LIMITED + Retry-After). */
  readonly rateLimited?: boolean;
  readonly customResponses?: Readonly<Record<number, CustomResponseDoc>>;
}

export interface ModuleApiDoc {
  /** "10", "16", ... or "app" for application-level routes. Used for the module-completion gate. */
  readonly moduleId: string;
  /** Where the module router is mounted under the API base path ("/schools", "/auth/password-recovery"). */
  readonly mountPath: string;
  readonly tag: { readonly name: string; readonly description: string };
  readonly operations: readonly OperationDoc[];
  /** Named component schemas of this module (referenced with `ref('Name')`). */
  readonly schemas?: Readonly<Record<string, SchemaObject>>;
}

export interface MessageLookup {
  has(code: string): boolean;
  message(code: string, locale: string): string;
}

export type OpenApiDocument = OpenAPIV3.Document;

/** Thrown by the document builder with EVERY problem found, so a contract can be fixed in one pass. */
export class OpenApiDocumentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid API contract (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n- ${problems.join('\n- ')}`);
    this.name = 'OpenApiDocumentError';
  }
}
