'use strict';

/**
 * Fixes ck_class_sessions_cancellation from create-class-sessions. A CHECK only rejects a row when it evaluates to FALSE, so a NULL (UNKNOWN) result was
 * accepted: a system cancellation (cancel_source = 'SCHEDULE_SLOT_RETIRED') with slot_retire_reason NULL, and a CANCELLED row with cancel_source NULL, both
 * slipped through. Every CANCELLED row now must say WHO or WHAT cancelled it, with each part explicitly NOT NULL:
 *   TEACHER               -> cancelled_by set, a non-blank reason, no slot retirement reason
 *   SCHEDULE_SLOT_RETIRED -> no actor, no free-text reason, a retirement reason in (REPLACED, REMOVED, GROUP_ARCHIVED)
 * The earlier migration is left untouched (migration history is never rewritten).
 */
const NOT_CANCELLED = "status <> 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancel_source IS NULL AND cancel_reason IS NULL AND slot_retire_reason IS NULL";

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE class_sessions DROP CONSTRAINT ck_class_sessions_cancellation');
    await queryInterface.sequelize.query(
      `ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_cancellation CHECK (
         (${NOT_CANCELLED})
         OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancel_source IS NOT NULL AND (
               (cancel_source = 'TEACHER' AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancel_reason)) > 0 AND slot_retire_reason IS NULL)
               OR (cancel_source = 'SCHEDULE_SLOT_RETIRED' AND cancelled_by IS NULL AND cancel_reason IS NULL AND slot_retire_reason IS NOT NULL AND slot_retire_reason IN ('REPLACED', 'REMOVED', 'GROUP_ARCHIVED'))
         )))`,
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('ALTER TABLE class_sessions DROP CONSTRAINT ck_class_sessions_cancellation');
    await queryInterface.sequelize.query(
      `ALTER TABLE class_sessions ADD CONSTRAINT ck_class_sessions_cancellation CHECK (
         (${NOT_CANCELLED})
         OR (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND (
               (cancel_source = 'TEACHER' AND cancelled_by IS NOT NULL AND cancel_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancel_reason)) > 0 AND slot_retire_reason IS NULL)
               OR (cancel_source = 'SCHEDULE_SLOT_RETIRED' AND cancelled_by IS NULL AND cancel_reason IS NULL AND slot_retire_reason IN ('REPLACED', 'REMOVED', 'GROUP_ARCHIVED'))
         )))`,
    );
  },
};
