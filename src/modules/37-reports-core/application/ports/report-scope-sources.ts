import type { GeographicLevel } from '../../domain/value-objects/report-scope';

/**
 * What the scope resolver needs to know about a user's CURRENT assignments. Each port is read through the owning module's public contract by an adapter in the composition root;
 * Module 37 itself reads no table and imports no service of another module. Every method answers from stored assignments (never from anything the client sent).
 */
export interface ReportScopeSources {
  /** Organizations the user administers (Module 13). */
  organizationIdsOfAdmin(userId: string): Promise<string[]>;
  /** Schools the user currently manages (Module 16). */
  schoolIdsOfManager(userId: string): Promise<string[]>;
  /** Schools a Subscription Collector is CURRENTLY assigned to (Module 33; an ended assignment grants nothing). */
  schoolIdsOfCollector(userId: string): Promise<string[]>;
  /** Groups a Teacher CURRENTLY teaches (Module 20). */
  groupIdsOfTeacher(userId: string): Promise<string[]>;
  /** The Parent's own linked children (Module 19). */
  studentIdsOfParent(userId: string): Promise<string[]>;
  /**
   * The geographic areas assigned to a Governorate / Center / Village manager. The role codes exist but NO assignment is stored by any module yet, so the production adapter answers `undefined`
   * ("not available") and the resolver denies. When an owner-approved assignment exists, only this adapter changes.
   */
  geographicAreasOfManager(userId: string, level: GeographicLevel): Promise<string[] | undefined>;
}
