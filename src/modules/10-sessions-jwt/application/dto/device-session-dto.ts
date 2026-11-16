/**
 * "My devices": one ACTIVE session of the caller's account, as shown to the user. It carries NO token, hash or secret.
 * `lastActiveAt` is when the session's tokens were last issued (login or refresh); the server does not track per-request activity.
 */
export interface DeviceSessionDto {
  readonly id: string;
  /** Coarse browser and operating system derived at login, for example "Chrome on Android"; null for a session created before the feature. */
  readonly deviceLabel: string | null;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  /** When the session ends if it is not refreshed (30 days after its last refresh). */
  readonly expiresAt: Date;
  /** True for the session that made this request. */
  readonly isCurrent: boolean;
}

export interface DeviceSessionListDto {
  readonly items: readonly DeviceSessionDto[];
  /** The account limit (3), so a client can say "2 of 3 devices". */
  readonly maxActiveSessions: number;
}
