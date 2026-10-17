import type { OpenAPIV3 } from 'openapi-types';
import { HTTP_METHODS, type OpenApiDocument } from '../../../src/modules/04-validation-api/public';
import { createSchemaChecker, dereference, validateOpenApi } from './schema-validation';

type Operation = OpenAPIV3.OperationObject & { 'x-module'?: string; 'x-full-path'?: string; 'x-authorization'?: { authentication?: string } };

export interface OperationRef {
  readonly method: string;
  readonly path: string;
  readonly operation: Operation;
}

export function operationsOf(document: OpenAPIV3.Document): OperationRef[] {
  const list: OperationRef[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as OpenAPIV3.PathItemObject | undefined)?.[method] as Operation | undefined;
      if (operation) list.push({ method, path, operation });
    }
  }
  return list;
}

const label = (o: OperationRef): string => `${o.method.toUpperCase()} ${o.path}`;

/**
 * The documentation quality rules every operation must satisfy (docs/API-DOCUMENTATION.md). Returns EVERY violation.
 * 1. The document is valid OpenAPI 3.0 and every $ref resolves.
 * 2. Every operation is complete: id, summary, description, tag, module, explicit security, authorization block, parameters.
 * 3. The standard responses that apply are documented (validation, authentication, authorization, payload size, internal).
 * 4. Every request example, response example and parameter example validates against its own schema.
 */
export async function lintOpenApi(document: OpenApiDocument): Promise<string[]> {
  const problems: string[] = [];
  try {
    await validateOpenApi(document);
  } catch (error) {
    return [`not a valid OpenAPI 3.0 document: ${(error as Error).message}`];
  }
  const resolved = await dereference(document);
  const checker = createSchemaChecker();
  const hasSecurityScheme = !!resolved.components?.securitySchemes?.bearerAuth;
  if (!hasSecurityScheme) problems.push('the bearerAuth security scheme is missing');
  if (!resolved.info.description?.includes('Authorize')) problems.push('the conventions (authentication, pagination, localization, errors) are missing from info.description');

  for (const o of operationsOf(resolved)) {
    const op = o.operation;
    const where = label(o);
    for (const field of ['operationId', 'summary', 'description'] as const) if (!op[field]?.trim()) problems.push(`${where}: ${field} is missing`);
    if (!op.tags || op.tags.length === 0) problems.push(`${where}: no tag`);
    if (!op['x-module']) problems.push(`${where}: x-module is missing`);
    if (!op['x-full-path']) problems.push(`${where}: x-full-path is missing`);
    if (!op['x-authorization']) problems.push(`${where}: x-authorization is missing`);
    if (!Array.isArray(op.security)) problems.push(`${where}: security must be declared explicitly ([] for a public operation)`);
    if (!op.description?.includes('**Authorization**')) problems.push(`${where}: the authorization block is missing from the description`);

    const responses = op.responses as Record<string, OpenAPIV3.ResponseObject>;
    const statuses = Object.keys(responses);
    if (!statuses.some((s) => s.startsWith('2'))) problems.push(`${where}: no success response`);
    const needs = (status: string, reason: string): void => {
      if (!statuses.includes(status)) problems.push(`${where}: response ${status} is missing (${reason})`);
    };
    needs('500', 'every operation');
    const params = (op.parameters ?? []) as OpenAPIV3.ParameterObject[];
    const hasInput = !!op.requestBody || params.some((p) => p.in === 'path' || p.in === 'query');
    if (hasInput) needs('400', 'the operation takes input');
    if (op.requestBody) needs('413', 'the operation takes a body');
    if (Array.isArray(op.security) && op.security.length > 0) {
      needs('401', 'the operation accepts a token');
      needs('403', 'the operation accepts a token');
    }
    if (!params.some((p) => p.name === 'Accept-Language')) problems.push(`${where}: the Accept-Language parameter is not documented`);
    for (const p of params) {
      if (p.in === 'path' && p.example !== undefined && p.schema) {
        for (const e of checker.check(p.schema as OpenAPIV3.SchemaObject, p.example)) problems.push(`${where}: example of path parameter "${p.name}" ${e}`);
      }
      if (p.in === 'query' && p.example !== undefined && p.schema) {
        for (const e of checker.check(p.schema as OpenAPIV3.SchemaObject, p.example)) problems.push(`${where}: example of query parameter "${p.name}" ${e}`);
      }
    }

    const body = (op.requestBody as OpenAPIV3.RequestBodyObject | undefined)?.content?.['application/json'];
    if (op.requestBody && !body) problems.push(`${where}: the request body is not documented as application/json`);
    if (body) {
      const examples = Object.entries(body.examples ?? {});
      if (examples.length === 0) problems.push(`${where}: the request body has no example`);
      for (const [name, ex] of examples) {
        for (const e of checker.check(body.schema as OpenAPIV3.SchemaObject, (ex as OpenAPIV3.ExampleObject).value)) problems.push(`${where}: request example "${name}" ${e}`);
      }
    }
    for (const [status, response] of Object.entries(responses)) {
      const content = response.content?.['application/json'];
      if (!content) continue;
      const examples = Object.entries(content.examples ?? {});
      if (examples.length === 0) problems.push(`${where}: response ${status} has no example`);
      for (const [name, ex] of examples) {
        for (const e of checker.check(content.schema as OpenAPIV3.SchemaObject, (ex as OpenAPIV3.ExampleObject).value)) problems.push(`${where}: response ${status} example "${name}" ${e}`);
      }
    }
  }
  return problems;
}
