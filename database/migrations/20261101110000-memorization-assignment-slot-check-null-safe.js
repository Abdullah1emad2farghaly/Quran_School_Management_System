'use strict';

/**
 * Module 27, fix of `ck_memorization_assignment_slot` (migration 20261101100000, additive; no data touched). The original CHECK
 * `(status = 'ACTIVE' AND active_slot = 1) OR (status = 'CANCELLED' AND active_slot IS NULL)` evaluates to NULL (not FALSE) for an ACTIVE row whose `active_slot`
 * is NULL, and SQL accepts a CHECK that evaluates to NULL: such a row was allowed and would have escaped the unique "one ACTIVE assignment per session and subject"
 * index (NULLs never collide). The new CHECK is NULL-safe: ACTIVE requires `active_slot = 1`, CANCELLED requires `active_slot IS NULL`, nothing else passes.
 * Found by `tests/db/memorization.test.ts` on the owner's database. The earlier migration is left untouched (migration history is never rewritten).
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE memorization_assignments DROP CONSTRAINT ck_memorization_assignment_slot');
    await queryInterface.sequelize.query(
      "ALTER TABLE memorization_assignments ADD CONSTRAINT ck_memorization_assignment_slot CHECK ((status = 'ACTIVE' AND COALESCE(active_slot, 0) = 1) OR (status = 'CANCELLED' AND active_slot IS NULL))",
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE memorization_assignments DROP CONSTRAINT ck_memorization_assignment_slot');
    await queryInterface.sequelize.query(
      "ALTER TABLE memorization_assignments ADD CONSTRAINT ck_memorization_assignment_slot CHECK ((status = 'ACTIVE' AND active_slot = 1) OR (status = 'CANCELLED' AND active_slot IS NULL))",
    );
  },
};
