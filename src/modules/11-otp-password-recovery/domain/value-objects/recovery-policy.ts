/**
 * Master Specification §26 plus the approved clarifications. Fixed business rules, not environment settings.
 * "3 resends per hour" means the first OTP plus at most 3 resends: 4 OTP requests per phone in a rolling hour.
 */
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const MAX_WRONG_ATTEMPTS = 5;
export const RESET_TOKEN_TTL_SECONDS = 10 * 60;

export const HOUR_WINDOW_SECONDS = 60 * 60;
export const MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR = 1 + 3; // first OTP + 3 resends

export const PHONE_IP_WINDOW_SECONDS = 15 * 60;
export const MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW = 5;
