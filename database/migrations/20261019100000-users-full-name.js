'use strict';

/**
 * Module 08 (Identity Core): the canonical personal name of the person behind an account (exactly three parts, one source of truth shared
 * by every role: organization manager, school manager, parent...). The column is NULLABLE and this migration invents NOTHING: existing
 * accounts keep NULL. Names that already exist elsewhere (organization_admins.name, schools.applicant_name, parents.full_name) are NOT
 * copied here because they may not satisfy the exactly-three-parts rule; use `npm run person-names:report` to see which accounts can be
 * filled safely and which need a human decision, and `npm run person-names:apply` to fill only the unambiguous ones.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'full_name', { type: Sequelize.STRING(200), allowNull: true });
  },

  async down() {
    throw new Error('Forward-only migration: dropping the column would delete the canonical personal names.');
  },
};
