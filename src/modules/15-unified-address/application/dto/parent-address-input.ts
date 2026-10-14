/**
 * Structured Parent Address input (API request, form). `centerName` / `villageName` are optional free text:
 * `null`, omitted and whitespace-only all mean "missing" and are stored as NULL. The country is NEVER an input: it is the
 * country of `organizationId`.
 */
export interface ParentAddressInput {
  /** The organization the parent belongs to (through its school). Its country is the only country a Parent Address can use. */
  readonly organizationId: unknown;
  readonly governorateId: unknown;
  readonly centerName?: unknown;
  readonly villageName?: unknown;
}

/** The organization's own address: the country is chosen (required); governorate required; center optional; village only under a center. */
export interface OrganizationAddressInput {
  readonly countryId: unknown;
  readonly governorateId: unknown;
  readonly centerId?: unknown;
  readonly villageId?: unknown;
}

/** A validated organization address: every node exists, is ACTIVE, belongs to the right parent, and the governorate belongs to `countryId`. */
export interface OrganizationAddress {
  readonly countryId: string;
  readonly governorateId: string;
  readonly centerId: string | null;
  readonly villageId: string | null;
}
