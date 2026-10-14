import { UnifiedAddressService } from '../modules/15-unified-address/public';
import { getGeographyService } from './geography';
import { getOrganizationService } from './organization';

let service: UnifiedAddressService | undefined;

/** Inject into other modules' use cases (Parents 17, Excel Import 36), typed as `UnifiedAddressLookup`. */
export function getUnifiedAddressService(): UnifiedAddressService {
  service ??= new UnifiedAddressService({ geography: getGeographyService(), organizations: getOrganizationService() });
  return service;
}
