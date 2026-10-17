import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { defaultMessageCatalog } from '../../src/modules/03-error-localization/public';
import {
  buildOpenApiDocument,
  listQueryParameters,
  OpenApiDocumentError,
  parseListQuery,
  publicEndpoint,
  schema as s,
  type ListQuerySpec,
  type ModuleApiDoc,
  type OperationDoc,
} from '../../src/modules/04-validation-api/public';
import { lintOpenApi, operationsOf } from './support/lint';
import { dereference } from './support/schema-validation';

beforeAll(() => registerAllErrorMessages());

const protectedAuth = { authentication: 'required', roles: ['MAIN_ADMIN'], scope: 'Own organization', enforcement: 'Service check', permissionId: null, decision: 'PROVISIONAL' } as const;
const item = s.object({ id: s.uuid({ example: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10' }), name: s.string({ maxLength: 50 }) }, ['id', 'name']);
const itemExample = { id: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10', name: 'Example' };

const LIST_SPEC: ListQuerySpec = {
  sortable: { name: 'name', createdAt: 'createdAt' },
  defaultSort: [{ key: 'createdAt', direction: 'desc' }],
  filters: {
    status: { type: 'enum', values: ['A', 'B'], multiple: true },
    kind: { type: 'enum', values: ['X', 'Y'] },
    owner: { type: 'uuid' },
    since: { type: 'date' },
    active: { type: 'boolean' },
    level: { type: 'integer' },
    label: { type: 'string', maxLength: 20 },
  },
  search: { maxLength: 40 },
};

const operations: OperationDoc[] = [
  {
    method: 'get',
    path: '/',
    operationId: 'listThings',
    summary: 'List things',
    description: 'Lists things.',
    authorization: protectedAuth,
    query: listQueryParameters(LIST_SPEC),
    success: { status: 200, description: 'A page of things.', data: item, example: itemExample, paginated: true },
  },
  {
    method: 'post',
    path: '/',
    operationId: 'createThing',
    summary: 'Create a thing',
    description: 'Creates a thing.',
    authorization: protectedAuth,
    request: { description: 'The thing.', schema: s.object({ name: s.string({ maxLength: 50 }) }, ['name']), examples: { basic: { summary: 'Basic', value: { name: 'Example' } } } },
    success: { status: 201, description: 'Created.', data: item, example: itemExample },
    errors: [{ status: 409, codes: ['SCHOOL_NAME_ALREADY_EXISTS'] }],
  },
  {
    method: 'delete',
    path: '/:id',
    operationId: 'deleteThing',
    summary: 'Delete a thing',
    description: 'Deletes a thing.',
    authorization: protectedAuth,
    pathParams: { id: { description: 'The thing id.', example: '3f6b1d52-8a4e-4c1b-9d77-2b6f0c9a1e10' } },
    success: { status: 204, description: 'Deleted.' },
    errors: [{ status: 404, codes: ['SCHOOL_NOT_FOUND'] }],
  },
  {
    method: 'post',
    path: '/public',
    operationId: 'publicThing',
    summary: 'Public submission',
    description: 'Public.',
    authorization: publicEndpoint(),
    rateLimited: true,
    request: { description: 'Body.', schema: s.object({ name: s.string() }, ['name']), examples: { a: { summary: 'A', value: { name: 'x' } } } },
    success: { status: 200, description: 'OK.', data: item, example: itemExample, noStore: true },
  },
];

const fixtureModule: ModuleApiDoc = { moduleId: '99', mountPath: '/things', tag: { name: 'Things', description: 'Test things.' }, operations };
const build = (modules: readonly ModuleApiDoc[] = [fixtureModule]) =>
  buildOpenApiDocument({ modules, basePath: '/api/v1', title: 'Test API', version: 'test', messages: defaultMessageCatalog });

describe('OpenAPI document builder', () => {
  it('produces a valid OpenAPI 3.0 document that satisfies every lint rule', async () => {
    expect(await lintOpenApi(build())).toEqual([]);
  });

  it('converts Express paths, keeps the full path and uses a relative server URL', () => {
    const doc = build();
    expect(Object.keys(doc.paths).sort()).toEqual(['/things', '/things/public', '/things/{id}']);
    expect(doc.servers?.[0]?.url).toBe('/api/v1');
    const del = (doc.paths['/things/{id}'] as unknown as { delete: { 'x-full-path': string; 'x-module': string } }).delete;
    expect(del['x-full-path']).toBe('/api/v1/things/{id}');
    expect(del['x-module']).toBe('99');
  });

  it('maps authentication modes to OpenAPI security requirements', () => {
    const doc = build();
    const security = (path: string, method: string) => (doc.paths[path] as Record<string, { security: unknown }>)[method]?.security;
    expect(security('/things', 'get')).toEqual([{ bearerAuth: [] }]);
    expect(security('/things/public', 'post')).toEqual([]);
    const optional = build([{ ...fixtureModule, operations: [{ ...operations[3]!, authorization: { ...publicEndpoint(), authentication: 'optional' } }] }]);
    expect((optional.paths['/things/public'] as { post: { security: unknown } }).post.security).toEqual([{}, { bearerAuth: [] }]);
  });

  it('adds the standard errors that apply to each operation shape', () => {
    const doc = build();
    const statuses = (path: string, method: string) => Object.keys((doc.paths[path] as Record<string, { responses: object }>)[method]?.responses ?? {}).sort();
    expect(statuses('/things', 'post')).toEqual(['201', '400', '401', '403', '409', '413', '500']);
    expect(statuses('/things/{id}', 'delete')).toEqual(['204', '400', '401', '403', '404', '500']);
    expect(statuses('/things/public', 'post')).toEqual(['200', '400', '413', '429', '500']);
  });

  it('documents Retry-After on 429 and Cache-Control on no-store answers', () => {
    const doc = build();
    const op = (doc.paths['/things/public'] as { post: { responses: Record<string, { headers: Record<string, unknown> }> } }).post;
    expect(Object.keys(op.responses['429']!.headers)).toContain('Retry-After');
    expect(Object.keys(op.responses['200']!.headers)).toContain('Cache-Control');
  });

  it('uses the real localized messages in error examples', async () => {
    const resolved = await dereference(build());
    const conflict = operationsOf(resolved).find((o) => o.operation.operationId === 'createThing')!.operation.responses['409'] as unknown as {
      content: { 'application/json': { examples: Record<string, { value: { error: { message: string } } }> } };
    };
    expect(conflict.content['application/json'].examples.SCHOOL_NAME_ALREADY_EXISTS?.value.error.message).toBe(defaultMessageCatalog.message('SCHOOL_NAME_ALREADY_EXISTS', 'en'));
  });

  it('reports EVERY problem at once and refuses to build', () => {
    const broken: ModuleApiDoc = {
      ...fixtureModule,
      operations: [
        ...operations,
        { ...operations[0]! }, // same route and same operationId twice
        { ...operations[2]!, operationId: 'noParamDoc', path: '/:other', pathParams: {} },
        { ...operations[1]!, operationId: 'unknownCode', path: '/unknown', errors: [{ status: 422, codes: ['NO_SUCH_CODE'] }] },
        { ...operations[2]!, operationId: 'with204Data', path: '/x', pathParams: undefined, success: { status: 204, description: 'x', data: item } },
        { ...operations[1]!, operationId: 'noExample', path: '/y', request: { description: 'd', schema: item, examples: {} } },
      ],
    };
    let error: unknown;
    try {
      build([broken]);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(OpenApiDocumentError);
    const problems = (error as OpenApiDocumentError).problems.join('\n');
    expect(problems).toMatch(/operationId "listThings" is used twice/);
    expect(problems).toMatch(/GET \/things is documented twice/);
    expect(problems).toMatch(/path parameter "other" is not documented/);
    expect(problems).toMatch(/NO_SUCH_CODE \(422\) is not in the message catalog/);
    expect(problems).toMatch(/204 must not declare data/);
    expect(problems).toMatch(/at least one request example is required/);
  });

  it('rejects a component schema defined by two modules', () => {
    const a: ModuleApiDoc = { ...fixtureModule, schemas: { Thing: item } };
    const b: ModuleApiDoc = { ...fixtureModule, moduleId: '98', mountPath: '/others', operations: [{ ...operations[0]!, operationId: 'listOthers' }], schemas: { Thing: item } };
    expect(() => build([a, b])).toThrow(/component schema "Thing" is defined twice/);
  });
});

describe('lint rules detect outdated or incomplete documentation', () => {
  const mutate = async (change: (doc: ReturnType<typeof build>) => void): Promise<string[]> => {
    const doc = structuredClone(build());
    change(doc);
    return lintOpenApi(doc);
  };
  const post = (doc: ReturnType<typeof build>) => (doc.paths['/things'] as { post: Record<string, any> }).post; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('flags a missing 401 on a protected operation', async () => {
    const problems = await mutate((d) => delete post(d).responses['401']);
    expect(problems.join('\n')).toMatch(/POST \/things: response 401 is missing/);
  });

  it('flags a request example that no longer matches its schema', async () => {
    const problems = await mutate((d) => {
      post(d).requestBody.content['application/json'].examples.basic.value = { name: 123 };
    });
    expect(problems.join('\n')).toMatch(/request example "basic"/);
  });

  it('flags a response example that no longer matches its schema', async () => {
    const problems = await mutate((d) => {
      post(d).responses['201'].content['application/json'].examples.success.value.data = { id: 'not-a-uuid', name: 'x' };
    });
    expect(problems.join('\n')).toMatch(/response 201 example "success"/);
  });

  it('flags a missing security declaration, operationId, summary and authorization block', async () => {
    const problems = await mutate((d) => {
      delete post(d).security;
      delete post(d).operationId;
      post(d).summary = '';
      post(d).description = 'no block';
    });
    const text = problems.join('\n');
    expect(text).toMatch(/security must be declared explicitly/);
    expect(text).toMatch(/operationId is missing/);
    expect(text).toMatch(/summary is missing/);
    expect(text).toMatch(/authorization block is missing/);
  });

  it('flags an unresolved $ref', async () => {
    const problems = await mutate((d) => {
      post(d).requestBody.content['application/json'].schema = { $ref: '#/components/schemas/Missing' };
    });
    expect(problems[0]).toMatch(/not a valid OpenAPI 3.0 document/);
  });
});

describe('listQueryParameters', () => {
  const parameters = listQueryParameters(LIST_SPEC);

  it('documents page, pageSize, sort, every filter and search from the same spec', () => {
    expect(parameters.map((p) => p.name)).toEqual(['page', 'pageSize', 'sort', 'filter[status]', 'filter[kind]', 'filter[owner]', 'filter[since]', 'filter[active]', 'filter[level]', 'filter[label]', 'search']);
    expect(parameters.find((p) => p.name === 'sort')?.description).toMatch(/name, createdAt/);
    expect(parameters.find((p) => p.name === 'sort')?.description).toMatch(/Default: -createdAt/);
  });

  it('every documented example is accepted by parseListQuery (documentation = enforcement)', () => {
    const query: Record<string, unknown> = {};
    const filter: Record<string, unknown> = {};
    for (const p of parameters) {
      const m = /^filter\[(.+)\]$/.exec(p.name);
      if (m) filter[m[1] as string] = p.example;
      else query[p.name] = p.example;
    }
    expect(() => parseListQuery({ ...query, filter }, LIST_SPEC)).not.toThrow();
  });

  it('documents list filters as comma-separated only where the spec allows it', () => {
    expect(parameters.find((p) => p.name === 'filter[status]')?.description).toMatch(/comma-separated/);
    expect(parameters.find((p) => p.name === 'filter[kind]')?.description).not.toMatch(/comma-separated/);
  });

  it('omits search when the spec has none', () => {
    expect(listQueryParameters({ ...LIST_SPEC, search: undefined }).map((p) => p.name)).not.toContain('search');
  });
});
