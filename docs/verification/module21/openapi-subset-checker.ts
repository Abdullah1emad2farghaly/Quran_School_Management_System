/**
 * The small OpenAPI/JSON-schema SUBSET checker used by `verify-module21-real-dataset.ts` to compare real response bodies with the
 * documented schemas (the project's Ajv conformance suite in `tests/api-docs` is the full check). It understands what the Module 21
 * documentation uses: `$ref`, `allOf`, `oneOf`, `nullable`, `type`, `required`, `properties` (every key must be documented),
 * `minimum`/`maximum` and `enum`. Anything it does not understand is NOT silently accepted for objects: undocumented keys are problems.
 *
 * `nullable: true` may sit on the schema itself or inside a `oneOf` branch (OpenAPI 3.0 cannot put `nullable` next to a bare `$ref`, so a
 * nullable reference is written as `oneOf: [ref, { type: 'object', nullable: true, enum: [null] }]`). A `oneOf` is satisfied by EXACTLY ONE branch.
 */
export interface SubsetChecker {
  /** Every problem found so far (append-only; callers compare lengths before and after). */
  readonly problems: string[];
  conforms(schema: any, value: any, where: string): void;
}

export function createSubsetChecker(schemas: Record<string, any>): SubsetChecker {
  const problems: string[] = [];
  function conforms(schema: any, value: any, where: string): void {
    if (schema.$ref) return conforms(schemas[schema.$ref.split('/').pop()!], value, where);
    if (schema.oneOf) {
      // A branch matches when it adds no problem; its problems are discarded, only the number of matches matters.
      const matching = schema.oneOf.filter((branch: any) => {
        const before = problems.length;
        conforms(branch, value, where);
        const ok = problems.length === before;
        problems.length = before;
        return ok;
      }).length;
      if (matching !== 1) problems.push(`${where}: matches ${matching} of ${schema.oneOf.length} oneOf branches (exactly 1 required)`);
      return;
    }
    if (value === null) {
      if (!schema.nullable) problems.push(`${where}: null not allowed`);
      return;
    }
    if (schema.allOf) return schema.allOf.forEach((s: any) => conforms(s, value, where));
    const t = schema.type;
    if (t === 'integer' && !Number.isInteger(value)) problems.push(`${where}: not an integer`);
    else if (t === 'string' && typeof value !== 'string') problems.push(`${where}: not a string`);
    else if (t === 'boolean' && typeof value !== 'boolean') problems.push(`${where}: not a boolean`);
    else if (t === 'array') {
      if (!Array.isArray(value)) problems.push(`${where}: not an array`);
      else value.forEach((v, i) => conforms(schema.items, v, `${where}[${i}]`));
    } else if (t === 'object') {
      if (typeof value !== 'object' || Array.isArray(value)) problems.push(`${where}: not an object`);
      else {
        for (const r of schema.required ?? []) if (!(r in value)) problems.push(`${where}: missing "${r}"`);
        for (const k of Object.keys(value)) {
          if (!schema.properties?.[k]) problems.push(`${where}: undocumented "${k}"`);
          else conforms(schema.properties[k], value[k], `${where}.${k}`);
        }
      }
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where}: < minimum`);
      if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where}: > maximum`);
    }
    if (schema.enum && !schema.enum.includes(value)) problems.push(`${where}: ${value} not in enum`);
  }
  return { problems, conforms };
}
