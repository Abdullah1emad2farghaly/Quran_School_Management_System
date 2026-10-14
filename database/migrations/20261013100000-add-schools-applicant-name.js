'use strict';

/**
 * Module 16: the applicant's name from the public school submission form (Main School and Sub-School).
 * IAM (Module 08) stores only the login identity (phone + password); it has no name, so the name the applicant typed is
 * kept with the school submission it belongs to. Nullable: schools created without a form (and rows created
 * before this migration) have none. A new migration: the applied `create-schools` migration is never edited.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('schools', 'applicant_name', { type: Sequelize.STRING(200), allowNull: true, after: 'created_by' });
    await queryInterface.sequelize.query('ALTER TABLE schools ADD CONSTRAINT ck_schools_applicant_name CHECK (applicant_name IS NULL OR CHAR_LENGTH(TRIM(applicant_name)) > 0)');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE schools DROP CONSTRAINT ck_schools_applicant_name');
    await queryInterface.removeColumn('schools', 'applicant_name');
  },
};
