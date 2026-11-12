import { publicEndpoint, schema as s, type ErrorDoc, type ModuleApiDoc } from '../../../04-validation-api/public';

const COUNTRY_ID = 'b2f0a8d1-5c34-4e7a-8d19-6a3c7e1f0b52';
const ORGANIZATION_ID = '7c1d5e93-2b8a-4f60-a1d4-9e3b6c0f8a21';
const GOVERNORATE_ID = '1e9d4c7b-0a62-4b8f-9c35-d7f1a2b6e840';

const REFERENCE = 'docs/GEOGRAPHY.md (public registration lookups); docs/SCHOOLS.md; docs/ORGANIZATION.md';
const ENFORCEMENT =
  'Public endpoint: no authentication, no permission. It is read-only reference data and only `{ id, name }` is returned (never the code, status, parent or any organization information).';
const NAMES =
  'Names are returned exactly as stored in the geography reference data (the stored name is Arabic); the same value is returned for `ar` and `en`, because the data model holds one name per node and no translation is invented. Error messages follow the request language (user preference, then `Accept-Language`, default `ar`).';

const lookupItem = s.object(
  { id: s.uuid({ description: 'The id to submit in the registration request.' }), name: s.string({ description: 'The display name, as stored.' }) },
  ['id', 'name'],
  { description: 'One selectable option.' },
);

const publicAuthorization = { ...publicEndpoint(ENFORCEMENT), reference: REFERENCE };

/** OpenAPI contract of `/geography` (`geography-routes.ts`). Module 14: PUBLIC registration lookups (read-only). */
export const geographyApiDoc: ModuleApiDoc = {
  moduleId: '14',
  mountPath: '/geography',
  tag: {
    name: 'Geography',
    description:
      'Public, read-only lookups for the registration forms (organization registration and school submission): the ACTIVE countries and the ACTIVE governorates of a country. Nothing is created, changed or deleted through the API; the reference data is loaded by `npm run seed:geography`.',
  },
  operations: [
    {
      method: 'get',
      path: '/countries',
      operationId: 'getCountries',
      summary: 'The countries available for registration (public)',
      description: `Returns the ACTIVE countries in code order, for the country selector of the organization registration form. ${NAMES}`,
      authorization: publicAuthorization,
      success: {
        status: 200,
        description: 'The countries (not paginated: a short reference list).',
        data: s.array(lookupItem),
        example: [{ id: COUNTRY_ID, name: 'مصر' }],
      },
    },
    {
      method: 'get',
      path: '/governorates',
      operationId: 'getGovernorates',
      summary: 'The governorates of a country (public)',
      description: `Returns the ACTIVE governorates in code order. EXACTLY ONE of \`countryId\` / \`organizationId\` must be sent. With \`countryId\` (organization registration) the country must exist and be ACTIVE. With \`organizationId\` (school submission) the organization must be one that may receive school submissions (ACTIVE, with a country); its country is derived from the database on the server and the client never sends it. ${NAMES}`,
      authorization: publicAuthorization,
      query: [
        { name: 'countryId', in: 'query', required: false, description: 'The selected country. Mutually exclusive with `organizationId`.', schema: { type: 'string', format: 'uuid' }, example: COUNTRY_ID },
        { name: 'organizationId', in: 'query', required: false, description: 'The selected organization (school submission). Mutually exclusive with `countryId`.', schema: { type: 'string', format: 'uuid' }, example: ORGANIZATION_ID },
      ],
      errors: [
        { status: 400, codes: ['GEOGRAPHY_NODE_INACTIVE'], description: 'The country (given directly or derived from the organization) is not ACTIVE.' },
        {
          status: 404,
          codes: ['GEOGRAPHY_NODE_NOT_FOUND', 'ORGANIZATION_NOT_FOUND'],
          description: 'The country does not exist, or the organization does not exist or may not receive school submissions (an ineligible organization is deliberately not revealed).',
        } satisfies ErrorDoc,
      ],
      success: {
        status: 200,
        description: 'The governorates of the country (not paginated: at most a few dozen).',
        data: s.array(lookupItem),
        example: [{ id: GOVERNORATE_ID, name: 'القاهرة' }],
      },
    },
  ],
};
