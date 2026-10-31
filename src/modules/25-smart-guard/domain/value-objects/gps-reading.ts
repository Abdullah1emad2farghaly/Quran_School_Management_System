import { smartGuardError } from '../errors/smart-guard-errors';

/** A Teacher's GPS reading as the client sends it. The same shape as the school's GPS fix (Module 16): `{ latitude, longitude, accuracyMeters }`. */
export interface GpsReading {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Reads the GPS input of a protected action.
 *  - nothing sent (undefined/null) or a field missing -> SMART_GUARD_GPS_REQUIRED (unavailable, denied or missing: all look the same to the backend);
 *  - anything that is not a valid fix (not numbers, latitude outside -90..90, longitude outside -180..180, accuracy not > 0) -> SMART_GUARD_GPS_INVALID.
 * The accuracy LIMIT (20 m) is NOT checked here: Smart Guard checks the distance first and then the accuracy, in the order of Master Specification §50.
 * No fallback of any kind (IP, manual location, postal address). This validates the shape of the reading only; it cannot prove that the phone reports the truth.
 */
export function readGpsReading(input: unknown): GpsReading {
  if (input === undefined || input === null) throw smartGuardError('SMART_GUARD_GPS_REQUIRED');
  if (typeof input !== 'object' || Array.isArray(input)) throw smartGuardError('SMART_GUARD_GPS_INVALID');
  const { latitude, longitude, accuracyMeters } = input as Record<string, unknown>;
  if ([latitude, longitude, accuracyMeters].some((v) => v === undefined || v === null)) throw smartGuardError('SMART_GUARD_GPS_REQUIRED');
  if (!finite(latitude) || !finite(longitude) || !finite(accuracyMeters)) throw smartGuardError('SMART_GUARD_GPS_INVALID');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracyMeters <= 0) throw smartGuardError('SMART_GUARD_GPS_INVALID');
  return { latitude, longitude, accuracyMeters };
}
