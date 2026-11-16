'use strict';

/**
 * Module 33 x Module 32. The time-driven unpaid-subscription reminders reuse the existing `notification_reminders` table (one row per kind and subject) instead of a second
 * scheduling mechanism, so its kind CHECK gains two values. Additive only: existing rows and kinds are untouched.
 *   SUBSCRIPTION_UNPAID_3D        subject = subscription id   (3 calendar days after the subscription was created, parents)
 *   SUBSCRIPTION_UNPAID_MONTH_END subject = bulk batch id     (the start of the final five calendar days of the month: parents, collectors, school manager)
 */
const OLD_KINDS = "'EXAM_24H', 'SESSION_HALF_TIME', 'SESSION_EVALUATION'";
const NEW_KINDS = `${OLD_KINDS}, 'SUBSCRIPTION_UNPAID_3D', 'SUBSCRIPTION_UNPAID_MONTH_END'`;

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE notification_reminders DROP CONSTRAINT ck_notification_reminders_kind');
    await queryInterface.sequelize.query(`ALTER TABLE notification_reminders ADD CONSTRAINT ck_notification_reminders_kind CHECK (kind IN (${NEW_KINDS}))`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM notification_reminders WHERE kind IN ('SUBSCRIPTION_UNPAID_3D', 'SUBSCRIPTION_UNPAID_MONTH_END')");
    await queryInterface.sequelize.query('ALTER TABLE notification_reminders DROP CONSTRAINT ck_notification_reminders_kind');
    await queryInterface.sequelize.query(`ALTER TABLE notification_reminders ADD CONSTRAINT ck_notification_reminders_kind CHECK (kind IN (${OLD_KINDS}))`);
  },
};
