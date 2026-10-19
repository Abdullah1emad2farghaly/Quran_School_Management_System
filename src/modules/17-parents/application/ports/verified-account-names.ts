import type { TransactionContext } from '../../../00-shared-kernel/public';

/**
 * Identity evidence for an EXISTING account that has no Parent record yet (for example an organization manager or a teacher whose phone
 * is now being registered as a Parent). A phone number alone never proves that two registrations are the same person (approved rule), so
 * the account may be reused only when a name that its OWNING module vouches for matches the submitted three-part name.
 *
 * Implementations are supplied by the composition root from the public contracts of the modules that own such names (for example the
 * Teachers module). When no module can vouch for a name, the list is empty and the registration is an identity conflict: nothing is
 * guessed, merged or overwritten.
 */
export interface VerifiedAccountNames {
  verifiedNamesOf(userId: string, tx?: TransactionContext): Promise<readonly string[]>;
}

/** The V1 default: no module owns a verified person name yet, so an existing non-Parent account can never be matched by name. */
export const NO_VERIFIED_ACCOUNT_NAMES: VerifiedAccountNames = {
  verifiedNamesOf: async () => [],
};
