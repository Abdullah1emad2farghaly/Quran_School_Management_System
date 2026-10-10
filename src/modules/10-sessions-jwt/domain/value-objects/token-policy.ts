/**
 * Master Specification §25. These are fixed business rules, not environment settings: changing them
 * needs an explicit, approved specification change (there is intentionally no env variable for them).
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
