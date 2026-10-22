import { PERSON_NAME_MAX_LENGTH } from '../../../08-identity-core/public';
import { groupError } from '../errors/group-errors';

export const GROUP_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];

/** §41: GROUP = same session assignment for the group; INDIVIDUAL = student-specific assignment. */
export const LEARNING_MODES = ['GROUP', 'INDIVIDUAL'] as const;
export type LearningMode = (typeof LEARNING_MODES)[number];

/** §42: FORWARD or BACKWARD. */
export const PROGRESSIONS = ['FORWARD', 'BACKWARD'] as const;
export type Progression = (typeof PROGRESSIONS)[number];

/** The Quran has 114 surahs (a fixed fact). The surah NAMES and the Quran structure belong to Module 21, which will link to this number. */
export const SURAH_COUNT = 114;

export const GROUP_NAME_MAX_LENGTH = PERSON_NAME_MAX_LENGTH;

export const isGroupStatus = (v: unknown): v is GroupStatus => typeof v === 'string' && (GROUP_STATUSES as readonly string[]).includes(v);

export function requireLearningMode(value: unknown): LearningMode {
  if (typeof value !== 'string' || !(LEARNING_MODES as readonly string[]).includes(value)) throw groupError('INVALID_GROUP_LEARNING_MODE');
  return value as LearningMode;
}
export function requireProgression(value: unknown): Progression {
  if (typeof value !== 'string' || !(PROGRESSIONS as readonly string[]).includes(value)) throw groupError('INVALID_GROUP_PROGRESSION');
  return value as Progression;
}
/** §43: the Starting Surah is required: a whole number from 1 to 114. */
export function requireStartingSurah(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > SURAH_COUNT) throw groupError('INVALID_GROUP_STARTING_SURAH');
  return value;
}

/** The group name: Unicode NFC, whitespace collapsed, trimmed, no control characters, 1-200 characters. */
export function normalizeGroupName(input: unknown): string {
  if (typeof input !== 'string') throw groupError('INVALID_GROUP_NAME');
  const name = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name === '' || /\p{Cc}/u.test(name) || [...name].length > GROUP_NAME_MAX_LENGTH) throw groupError('INVALID_GROUP_NAME');
  return name;
}
/** Uniqueness key among the ACTIVE groups of a school: the normalized name, Latin letters case-insensitive, Arabic letters never folded. */
export const groupNameKey = (name: string): string => name.toLowerCase();

export const GROUP_REASON_MAX_LENGTH = 500;
export function normalizeGroupReason(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string') throw groupError('INVALID_GROUP_REASON');
  const reason = input.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (reason === '') return null;
  if (/\p{Cc}/u.test(reason) || [...reason].length > GROUP_REASON_MAX_LENGTH) throw groupError('INVALID_GROUP_REASON');
  return reason;
}
