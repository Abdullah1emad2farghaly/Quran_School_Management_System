/** Master Specification §22: ACTIVE <-> INACTIVE (reversible). */
export const USER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
