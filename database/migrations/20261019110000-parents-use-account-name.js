'use strict';

/**
 * Module 17 (Parents): the personal name is stored ONCE, on the account (`users.full_name`, Module 08), not copied onto the Parent record.
 * This migration moves the existing Parent names to the account and drops `parents.full_name`. It is safe by construction:
 *  1. a Parent name that is exactly three parts is copied to its account ONLY where the account has no name yet (nothing is overwritten);
 *  2. if ANY Parent is left whose account name is missing or differs (for example a Parent registered with a four-part name under the previous
 *     rule), the migration STOPS WITHOUT dropping anything and lists them: fix those records (or run `npm run person-names:report`) and run it again;
 *  3. only when every Parent is consistent with its account is the column dropped.
 * Re-running is harmless (step 1 only fills NULLs).
 */
module.exports = {
  async up(queryInterface) {
    const sequelize = queryInterface.sequelize;
    await sequelize.query(
      `UPDATE users u JOIN parents p ON p.user_id = u.id
          SET u.full_name = p.full_name
        WHERE u.full_name IS NULL AND p.full_name REGEXP '^[^ ]+ [^ ]+ [^ ]+$'`,
    );
    const [inconsistent] = await sequelize.query(
      `SELECT p.id AS parent_id, p.user_id AS user_id
         FROM parents p JOIN users u ON u.id = p.user_id
        WHERE u.full_name IS NULL OR LOWER(u.full_name) COLLATE utf8mb4_bin <> LOWER(p.full_name) COLLATE utf8mb4_bin
        LIMIT 20`,
    );
    if (inconsistent.length > 0) {
      const sample = inconsistent.map((r) => `${r.parent_id} (user ${r.user_id})`).join(', ');
      throw new Error(
        `Cannot move Parent names to the accounts: ${inconsistent.length}${inconsistent.length === 20 ? '+' : ''} Parent record(s) have a name that is not exactly three parts or differs from the account's name. ` +
          `Nothing was dropped. Affected (first 20): ${sample}. Correct them, then run the migration again.`,
      );
    }
    await queryInterface.removeColumn('parents', 'full_name');
  },

  async down() {
    throw new Error('Forward-only migration: the Parent name now lives on the account (users.full_name).');
  },
};
