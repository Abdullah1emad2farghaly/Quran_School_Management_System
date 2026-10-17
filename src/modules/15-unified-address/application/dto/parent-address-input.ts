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

/**
 * The organization's own address: the country is chosen (required); the governorate is a registered, ACTIVE governorate of that
 * country; center/city and village are FREE TEXT (optional; a village only under a center).
 */
export interface OrganizationAddressInput {
  readonly countryId: unknown;
  readonly governorateId: unknown;
  readonly centerName?: unknown;
  readonly villageName?: unknown;
}

/** A validated organization address (normalized free text, registered governorate belonging to `countryId`). */
export interface OrganizationAddress {
  readonly countryId: string;
  readonly governorateId: string;
  readonly centerName: string | null;
  readonly villageName: string | null;
}

/**
 * A school's address. Same contract as the Parent address: the country is NEVER an input (it is the country of the school's
 * organization), the governorate is registered, center/city and village are free text.
 */
export type SchoolAddressInput = ParentAddressInput;
