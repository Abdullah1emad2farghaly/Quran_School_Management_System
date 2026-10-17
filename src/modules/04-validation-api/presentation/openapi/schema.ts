import type { OpenAPIV3 } from 'openapi-types';
import type { SchemaObject, SchemaOrRef } from './types';

/** Small helpers so contracts stay readable. They only build plain OpenAPI 3.0 schema objects. */
export const ref = (name: string): OpenAPIV3.ReferenceObject => ({ $ref: `#/components/schemas/${name}` });

interface Common {
  readonly description?: string;
  readonly example?: unknown;
  readonly nullable?: boolean;
}

export const string = (options: Common & { maxLength?: number; minLength?: number; format?: string; enum?: readonly string[]; pattern?: string } = {}): SchemaObject => {
  const { enum: values, ...rest } = options;
  return { type: 'string', ...rest, ...(values ? { enum: [...values] } : {}) };
};

export const uuid = (options: Common = {}): SchemaObject => string({ format: 'uuid', ...options });
export const dateTime = (options: Common = {}): SchemaObject => string({ format: 'date-time', ...options });
export const integer = (options: Common & { minimum?: number; maximum?: number } = {}): SchemaObject => ({ type: 'integer', ...options });
export const number = (options: Common & { minimum?: number; maximum?: number } = {}): SchemaObject => ({ type: 'number', ...options });
export const boolean = (options: Common = {}): SchemaObject => ({ type: 'boolean', ...options });

export const object = (properties: Readonly<Record<string, SchemaOrRef>>, required: readonly string[] = [], options: { description?: string } = {}): SchemaObject => ({
  type: 'object',
  properties: { ...properties },
  ...(required.length > 0 ? { required: [...required] } : {}),
  ...options,
});

export const array = (items: SchemaOrRef, options: { description?: string } = {}): SchemaObject => ({ type: 'array', items, ...options });

/** OpenAPI 3.0 cannot put `nullable` next to a bare `$ref`; this wraps it in `allOf`. */
export const nullableRef = (name: string): SchemaObject => ({ nullable: true, allOf: [ref(name)] });
