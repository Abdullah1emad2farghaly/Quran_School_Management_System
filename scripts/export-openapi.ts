import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerAllErrorMessages } from '../src/app/bootstrap/register-error-messages';
import { buildApiDocument } from '../src/app/openapi/api-documents';

/**
 * Optional: writes the generated OpenAPI document to `dist/openapi.json` (git-ignored) for tools such as Postman or client
 * generators. The document is NOT committed: the running application serves it at /api-docs.json (docs/API-DOCUMENTATION.md).
 */
registerAllErrorMessages();
const target = join(process.cwd(), 'dist', 'openapi.json');
mkdirSync(join(process.cwd(), 'dist'), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildApiDocument(), null, 2)}\n`, 'utf8');
console.log(`OpenAPI document written to ${target}`);
