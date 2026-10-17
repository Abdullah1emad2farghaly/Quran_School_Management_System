import type { OpenAPIV3 } from 'openapi-types';
import type request from 'supertest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { API_BASE_PATH } from '../../../src/app/routes';
import { buildApiDocument } from '../../../src/app/openapi/api-documents';
import { createSchemaChecker, dereference, type JsonSchemaChecker } from './schema-validation';
import { operationsOf, type OperationRef } from './lint';

interface Compiled {
  readonly ref: OperationRef;
  readonly key: string;
  readonly pattern: RegExp;
  readonly params: number;
}

/**
 * Checks REAL responses (from the existing in-memory HTTP harnesses) against the OpenAPI document and records which operations
 * were exercised. A response conforms when its operation is documented, its status is documented, its body matches the documented
 * schema, a documented error carries a documented code, and the documented required headers are present.
 * `assertAllExercised` is the completion gate: every documented operation of a module must have been called successfully.
 */
export class ApiConformance {
  private readonly compiled: Compiled[];
  private readonly seen = new Map<string, Set<number>>();

  private constructor(
    operations: OperationRef[],
    private readonly checker: JsonSchemaChecker,
  ) {
    this.compiled = operations
      .map((ref) => ({
        ref,
        key: `${ref.method.toUpperCase()} ${ref.path}`,
        pattern: new RegExp(`^${ref.path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`),
        params: (ref.path.match(/\{/g) ?? []).length,
      }))
      .sort((a, b) => a.params - b.params);
  }

  static async create(): Promise<ApiConformance> {
    registerAllErrorMessages();
    const resolved = await dereference(buildApiDocument());
    return new ApiConformance(operationsOf(resolved), createSchemaChecker());
  }

  /** Throws with a precise message when the response does not match its documentation; otherwise records it and returns it. */
  conforms(res: request.Response): request.Response {
    const method = String((res as unknown as { request: { method: string } }).request.method).toLowerCase();
    const url = new URL((res as unknown as { request: { url: string } }).request.url);
    const path = url.pathname.startsWith(API_BASE_PATH) ? url.pathname.slice(API_BASE_PATH.length) : url.pathname;
    const found = this.compiled.find((c) => c.ref.method === method && c.pattern.test(path));
    if (!found) throw new Error(`${method.toUpperCase()} ${url.pathname} is not documented in OpenAPI`);
    const op = found.ref.operation;
    const responses = op.responses as Record<string, OpenAPIV3.ResponseObject>;
    const response = responses[String(res.status)];
    const where = `${found.key} -> ${res.status}`;
    if (!response) throw new Error(`${where}: this status is not documented (documented: ${Object.keys(responses).join(', ')}). Body: ${JSON.stringify(res.body)}`);

    for (const [name, header] of Object.entries((response.headers ?? {}) as Record<string, OpenAPIV3.HeaderObject>)) {
      if (header.required && res.headers[name.toLowerCase()] === undefined) throw new Error(`${where}: the documented required header ${name} is missing`);
    }
    const content = response.content?.['application/json'];
    if (!content) {
      if (res.status === 204 && res.text !== '' && res.text !== undefined) throw new Error(`${where}: a 204 must have no body`);
    } else {
      const problems = this.checker.check(content.schema as OpenAPIV3.SchemaObject, res.body);
      if (problems.length > 0) throw new Error(`${where}: the body does not match the documented schema: ${problems.join('; ')}\n${JSON.stringify(res.body)}`);
      if (res.status >= 400 && res.body?.success === false && res.body?.error) {
        const documented = Object.values((content.examples ?? {}) as Record<string, OpenAPIV3.ExampleObject>).map((e) => (e.value as { error: { code: string } }).error.code);
        if (!documented.includes(res.body.error.code)) throw new Error(`${where}: the error code ${res.body.error.code} is not documented (documented: ${documented.join(', ')})`);
      }
    }
    const statuses = this.seen.get(found.key) ?? new Set<number>();
    statuses.add(res.status);
    this.seen.set(found.key, statuses);
    return res;
  }

  /** The completion gate: every documented operation of the module must have produced its documented success response. */
  assertAllExercised(moduleId: string): void {
    const missing: string[] = [];
    for (const c of this.compiled) {
      if (c.ref.operation['x-module'] !== moduleId) continue;
      const success = Object.keys(c.ref.operation.responses).find((s) => s.startsWith('2'));
      if (!success || !this.seen.get(c.key)?.has(Number(success))) missing.push(`${c.key} (expected ${success})`);
    }
    if (missing.length > 0) throw new Error(`module ${moduleId}: documented operations never exercised with their success response:\n${missing.join('\n')}`);
  }

  operationCount(moduleId: string): number {
    return this.compiled.filter((c) => c.ref.operation['x-module'] === moduleId).length;
  }
}
