/**
 * The school the user works in as School Manager, for the login response. Module 10 never reads school data itself: the composition root
 * supplies this port from the public contract of Module 16 (Schools).
 */
export interface ManagedSchoolResolver {
  /** The id of the school the user actively manages, or null when the user is not a School Manager. */
  findManagedSchoolId(userId: string): Promise<string | null>;
}
