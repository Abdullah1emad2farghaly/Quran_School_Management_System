import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { GeographyNode } from '../../domain/entities/geography-node';
import { geographyError } from '../../domain/errors/geography-errors';
import type { GeographyLevel } from '../../domain/value-objects/geography-level';
import { toGeographyNodeDto, type GeographyNodeDto, type ValidatedGeography } from '../dto/geography-dto';
import type { GeographyRepository } from '../ports/geography-repository';

export interface HierarchyInput {
  /** Required: an address always has a governorate (Master Specification §28). */
  readonly governorateId: string;
  /** Optional. */
  readonly centerId?: string | null;
  /** Optional, but a village cannot exist without its center (§28). */
  readonly villageId?: string | null;
}

export interface ValidateHierarchyOptions {
  /** Default true: a node that is not ACTIVE is rejected (GEOGRAPHY_NODE_INACTIVE). */
  readonly requireActive?: boolean;
}

/**
 * Module 14 public contract: READ-ONLY. There is no create/rename/delete here and no HTTP endpoint; the reference seed
 * is loaded by the seed CLI. Other modules (Unified Address 15, Schools 16) depend on `GeographyLookup`.
 */
export class GeographyService {
  constructor(private readonly repository: GeographyRepository) {}

  getCountry(id: string, tx?: TransactionContext): Promise<GeographyNodeDto | undefined> {
    return this.get('COUNTRY', id, tx);
  }
  getGovernorate(id: string, tx?: TransactionContext): Promise<GeographyNodeDto | undefined> {
    return this.get('GOVERNORATE', id, tx);
  }
  getCenter(id: string, tx?: TransactionContext): Promise<GeographyNodeDto | undefined> {
    return this.get('CENTER', id, tx);
  }
  getVillage(id: string, tx?: TransactionContext): Promise<GeographyNodeDto | undefined> {
    return this.get('VILLAGE', id, tx);
  }

  listCountries(tx?: TransactionContext): Promise<GeographyNodeDto[]> {
    return this.list('COUNTRY', null, tx);
  }
  listGovernorates(countryId: string, tx?: TransactionContext): Promise<GeographyNodeDto[]> {
    return this.list('GOVERNORATE', countryId, tx);
  }
  listCenters(governorateId: string, tx?: TransactionContext): Promise<GeographyNodeDto[]> {
    return this.list('CENTER', governorateId, tx);
  }
  listVillages(centerId: string, tx?: TransactionContext): Promise<GeographyNodeDto[]> {
    return this.list('VILLAGE', centerId, tx);
  }

  /**
   * Validates a geographic position and returns the resolved chain. Rules: the governorate is required; a village needs a
   * center; the center must belong to the governorate and the village to the center; every node must exist (and, by
   * default, be ACTIVE). Errors: INVALID_GEOGRAPHY_HIERARCHY, GEOGRAPHY_NODE_NOT_FOUND, GEOGRAPHY_NODE_INACTIVE.
   */
  async validateHierarchy(input: HierarchyInput, options: ValidateHierarchyOptions = {}, tx?: TransactionContext): Promise<ValidatedGeography> {
    const requireActive = options.requireActive ?? true;
    const present = (v: unknown): v is string => typeof v === 'string' && v !== '';
    const { governorateId, centerId, villageId } = input ?? ({} as HierarchyInput);

    if (!present(governorateId)) throw geographyError('INVALID_GEOGRAPHY_HIERARCHY');
    if ((centerId !== undefined && centerId !== null && !present(centerId)) || (villageId !== undefined && villageId !== null && !present(villageId))) {
      throw geographyError('INVALID_GEOGRAPHY_HIERARCHY');
    }
    if (present(villageId) && !present(centerId)) throw geographyError('INVALID_GEOGRAPHY_HIERARCHY');

    const governorate = await this.require('GOVERNORATE', governorateId, tx);
    const country = await this.require('COUNTRY', governorate.parentId as string, tx);
    const center = present(centerId) ? await this.require('CENTER', centerId, tx) : null;
    if (center && center.parentId !== governorate.id) throw geographyError('INVALID_GEOGRAPHY_HIERARCHY');
    const village = present(villageId) ? await this.require('VILLAGE', villageId, tx) : null;
    if (village && village.parentId !== center?.id) throw geographyError('INVALID_GEOGRAPHY_HIERARCHY');

    if (requireActive && [country, governorate, center, village].some((n) => n !== null && n.status !== 'ACTIVE')) {
      throw geographyError('GEOGRAPHY_NODE_INACTIVE');
    }
    return {
      country: toGeographyNodeDto(country),
      governorate: toGeographyNodeDto(governorate),
      center: center ? toGeographyNodeDto(center) : null,
      village: village ? toGeographyNodeDto(village) : null,
    };
  }

  private async get(level: GeographyLevel, id: string, tx?: TransactionContext): Promise<GeographyNodeDto | undefined> {
    if (typeof id !== 'string' || id === '') return undefined;
    const node = await this.repository.findById(level, id, tx);
    return node ? toGeographyNodeDto(node) : undefined;
  }

  private async list(level: GeographyLevel, parentId: string | null, tx?: TransactionContext): Promise<GeographyNodeDto[]> {
    if (level !== 'COUNTRY' && (typeof parentId !== 'string' || parentId === '')) return [];
    return (await this.repository.listChildren(level, parentId, tx)).map(toGeographyNodeDto);
  }

  private async require(level: GeographyLevel, id: string, tx?: TransactionContext): Promise<GeographyNode> {
    const node = await this.repository.findById(level, id, tx);
    if (!node) throw geographyError('GEOGRAPHY_NODE_NOT_FOUND');
    return node;
  }
}

/** What downstream modules should depend on (read-only). */
export type GeographyLookup = Pick<
  GeographyService,
  | 'getCountry'
  | 'getGovernorate'
  | 'getCenter'
  | 'getVillage'
  | 'listCountries'
  | 'listGovernorates'
  | 'listCenters'
  | 'listVillages'
  | 'validateHierarchy'
>;
