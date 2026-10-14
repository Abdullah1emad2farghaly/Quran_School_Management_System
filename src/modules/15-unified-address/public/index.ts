// Public contract of Module 15 (Unified Address): reusable PARENT address normalization, parsing and validation.
//   Parent Address = Governorate (registered, id) / Center or City (free text) / Village (free text), Master Specification §28.
// Pure application logic: NO tables, NO migration, NO endpoints, NO permissions, NO events. The country of a Parent Address is the
// country of the parent's ORGANIZATION (Module 13, `organizationId`), and the Governorate is validated against it with Geography (Module 14).
// Also validates the ORGANIZATION's own address (`validateOrganizationAddress`: country + governorate + optional center/village).
// Persistence and history of a Parent's address belong to the Parents module (17); see docs/UNIFIED-ADDRESS.md.
// School addresses keep their structured rules (`GeographyLookup.validateHierarchy`); they are not handled here.
export {
  UnifiedAddressService,
  type UnifiedAddressLookup,
  type UnifiedAddressServiceDeps,
} from '../application/services/unified-address-service';
export type { ParentAddressInput, OrganizationAddressInput, OrganizationAddress } from '../application/dto/parent-address-input';
export type { ParentAddress, StoredParentAddress } from '../domain/value-objects/parent-address';
export { normalizeAddressText, PARENT_ADDRESS_TEXT_MAX_LENGTH } from '../domain/value-objects/address-text';
export { parseRawParentAddress, type RawParentAddressParts } from '../domain/services/raw-parent-address-parser';
export {
  UnifiedAddressErrorCodes,
  unifiedAddressError,
  type UnifiedAddressErrorCode,
  type ParentAddressField,
} from '../domain/errors/unified-address-errors';
export { UNIFIED_ADDRESS_ERROR_MESSAGES } from '../application/services/unified-address-error-messages';
