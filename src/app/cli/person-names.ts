/**
 * One-time maintenance tool for installations that already have accounts created BEFORE the canonical personal name (`users.full_name`)
 * existed. It never invents data:
 *   npm run person-names:report   lists the accounts without a name and, for each, whether a name recorded earlier
 *                                 (organization_admins.name, schools.applicant_name) can fill it safely or needs a human decision
 *   npm run person-names:apply    fills ONLY the safe ones (all recorded names are valid, exactly three parts, and agree), inside one
 *                                 transaction, never overwriting an existing name. Accounts that need review are left untouched.
 * Reading the earlier name columns here is deliberate: this is an operations script, not module code. Run `npm run db:migrate` first.
 */
import { QueryTypes } from 'sequelize';
import { closeDatabase, getSequelize } from '../../config/database';
import { classifyAccounts, parsePersonNamesArgs, type NameCandidate } from './person-names-cli';

const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

async function main(): Promise<number> {
  const args = parsePersonNamesArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    return EXIT_USAGE;
  }
  const db = getSequelize();
  try {
    const users = await db.query<{ id: string }>('SELECT id FROM users WHERE full_name IS NULL ORDER BY created_at, id', { type: QueryTypes.SELECT });
    const fromAdmins = await db.query<{ userId: string; value: string | null }>('SELECT user_id AS userId, name AS value FROM organization_admins WHERE name IS NOT NULL', { type: QueryTypes.SELECT });
    const fromSchools = await db.query<{ userId: string; value: string | null }>('SELECT applicant_user_id AS userId, applicant_name AS value FROM schools WHERE applicant_name IS NOT NULL AND applicant_user_id IS NOT NULL', { type: QueryTypes.SELECT });
    const candidates: NameCandidate[] = [
      ...fromAdmins.map((r) => ({ userId: r.userId, source: 'organization_admins.name' as const, value: r.value })),
      ...fromSchools.map((r) => ({ userId: r.userId, source: 'schools.applicant_name' as const, value: r.value })),
    ];
    const result = classifyAccounts(users.map((u) => u.id), candidates);
    const fillable = result.filter((r) => r.kind === 'fillable');
    const review = result.filter((r) => r.kind === 'needs-review');
    console.log(`Accounts without a personal name: ${result.length} (fillable: ${fillable.length}, need review: ${review.length}).`);
    for (const r of review) console.log(`  REVIEW ${r.userId}: ${r.reason}${r.candidates.length ? ` (recorded: ${r.candidates.map((c) => JSON.stringify(c)).join(' | ')})` : ''}`);
    if (args.mode === 'report') {
      for (const r of fillable) console.log(`  FILLABLE ${r.userId}: ${JSON.stringify(r.name)} <- ${r.sources.join(', ')}`);
      return EXIT_OK;
    }
    await db.transaction(async (transaction) => {
      for (const r of fillable) {
        await db.query('UPDATE users SET full_name = :name, updated_at = UTC_TIMESTAMP(3), version = version + 1 WHERE id = :id AND full_name IS NULL', { replacements: { id: r.userId, name: r.name }, transaction });
      }
    });
    console.log(`Filled ${fillable.length} account(s). ${review.length} account(s) were left untouched and need a human decision.`);
    return EXIT_OK;
  } finally {
    await closeDatabase();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`person-names failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    process.exit(EXIT_FAILED);
  },
);
