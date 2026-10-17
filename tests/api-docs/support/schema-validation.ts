import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { OpenAPIV3 } from 'openapi-types';
import type { OpenApiDocument } from '../../../src/modules/04-validation-api/public';

/** Validates a document against the OpenAPI 3.0 schema AND resolves every `$ref` (throws with the reason otherwise). */
export async function validateOpenApi(document: OpenApiDocument): Promise<void> {
  await SwaggerParser.validate(structuredClone(document) as never);
}

export interface JsonSchemaChecker {
  /** Returns the list of problems (empty = the value matches the schema). */
  check(schema: OpenAPIV3.SchemaObject, value: unknown): string[];
}

const describe = (errors: readonly ErrorObject[] | null | undefined): string[] => (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);

/** Ajv configured for OpenAPI 3.0 schemas (`nullable`, `example` and `x-` keywords are accepted; formats are enforced). */
export function createSchemaChecker(): JsonSchemaChecker {
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const cache = new WeakMap<object, ValidateFunction>();
  return {
    check(schema, value) {
      let validate = cache.get(schema);
      if (!validate) {
        validate = ajv.compile(schema);
        cache.set(schema, validate);
      }
      return validate(value) ? [] : describe(validate.errors);
    },
  };
}

/** A fully dereferenced copy of the document, ready for schema lookups by operation. */
export async function dereference(document: OpenApiDocument): Promise<OpenAPIV3.Document> {
  return (await SwaggerParser.dereference(structuredClone(document) as never)) as OpenAPIV3.Document;
}
