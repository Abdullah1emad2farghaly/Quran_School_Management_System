import express from 'express';
import { body } from 'express-validator';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { buildPageResult } from '../../src/modules/00-shared-kernel/public';
import {
  parseListQuery,
  sendCreated,
  sendPaginated,
  validate,
  type ListQuerySpec,
} from '../../src/modules/04-validation-api/public';

registerAllErrorMessages();

const spec: ListQuerySpec = {
  sortable: { name: 'name' },
  defaultSort: [{ key: 'name', direction: 'asc' }],
  filters: { status: { type: 'enum', values: ['active', 'inactive'] } },
  search: {},
};

const app = express();
app.use(requestContextMiddleware);
app.use(express.json());
app.get('/items', (req, res) => {
  const q = parseListQuery(req.query, spec);
  sendPaginated(res, buildPageResult([q.sort[0]?.key ?? ''], 41, q.page));
});
app.post('/things', validate(body('name').trim().notEmpty().withMessage('REQUIRED_FIELD')), (_req, res) => {
  sendCreated(res, { ok: true });
});
app.use(notFoundHandler);
app.use(errorHandler);

describe('success envelope and pagination', () => {
  it('returns data, paging meta and requestId', async () => {
    const res = await request(app).get('/items?page=2&pageSize=500&filter[status]=active');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(['name']);
    expect(res.body.meta).toEqual({ page: 2, pageSize: 100, total: 41, totalPages: 1 });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
  it('returns 201 for created resources', async () => {
    const res = await request(app).post('/things').send({ name: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ ok: true });
  });
});

describe('validation errors over HTTP', () => {
  it('rejects non-whitelisted sort with a localized field message (ar by default)', async () => {
    const res = await request(app).get('/items?sort=password');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const field = res.body.error.details.fields[0];
    expect(field.field).toBe('sort');
    expect(field.code).toBe('UNKNOWN_SORT_FIELD');
    expect(field.message).toBe('لا يمكن الترتيب حسب "password".');
  });
  it('localizes field messages to English and keeps codes identical', async () => {
    const res = await request(app).get('/items?sort=password').set('Accept-Language', 'en');
    const field = res.body.error.details.fields[0];
    expect(field.code).toBe('UNKNOWN_SORT_FIELD');
    expect(field.message).toBe('Sorting by "password" is not allowed.');
  });
  it('rejects unknown query parameters and bad filters together', async () => {
    const res = await request(app).get('/items?foo=1&filter[nope]=1');
    expect(res.body.error.details.fields.map((f: { code: string }) => f.code)).toEqual([
      'UNKNOWN_QUERY_PARAMETER',
      'UNKNOWN_FILTER',
    ]);
  });
  it('express-validator failures use the same structure', async () => {
    const res = await request(app).post('/things').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields[0].field).toBe('name');
    expect(res.body.error.details.fields[0].code).toBe('REQUIRED_FIELD');
    expect(res.body.error.details.fields[0].message).toBe('هذا الحقل مطلوب.');
  });
  it('never echoes submitted values', async () => {
    const res = await request(app).get('/items?filter[status]=top-secret-value');
    expect(JSON.stringify(res.body).includes('top-secret-value')).toBe(false);
  });
});
