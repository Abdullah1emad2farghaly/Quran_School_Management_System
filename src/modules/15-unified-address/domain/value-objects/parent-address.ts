/**
 * A validated Parent Address: `Governorate / Center or City / Village` (Master Specification §28).
 * The country is never part of it (it comes from the Main Organization).
 * - `governorateId`: primary key of a registered Governorate of the organization's country.
 * - `governorateName`: the Governorate's name AT VALIDATION TIME. Persist it in the address HISTORY so an old address
 *   keeps reading the same even if the Governorate is renamed later (see docs/UNIFIED-ADDRESS.md).
 * - `centerName` / `villageName`: free text (NFC, whitespace-normalized, at most 200 characters), `null` when missing.
 *   A village never exists without a center. They need not exist in the geography tables.
 */
export interface ParentAddress {
  readonly governorateId: string;
  readonly governorateName: string;
  readonly centerName: string | null;
  readonly villageName: string | null;
}

/** A stored address as read back (current row or history row). `governorateName` is the history snapshot when there is one. */
export interface StoredParentAddress {
  readonly governorateId: string;
  readonly governorateName?: string | null;
  readonly centerName?: string | null;
  readonly villageName?: string | null;
}
