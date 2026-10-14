import { schoolError } from '../errors/school-errors';

/** Maximum accepted GPS accuracy (metres) for an official school location (§30). */
export const GPS_MAX_ACCURACY_METERS = 20;
/** Geofence radius (metres) around the official school centre (§30). Used by Smart Guard / attendance later. */
export const SCHOOL_GEOFENCE_RADIUS_METERS = 50;

export interface GpsFix {
  readonly latitude: number;
  readonly longitude: number;
  /** Reported horizontal accuracy in metres (> 0 and <= 20). */
  readonly accuracyMeters: number;
}

const round = (value: number, decimals: number): number => Math.round(value * 10 ** decimals) / 10 ** decimals;

/**
 * Validates a physical GPS fix: finite numbers, latitude -90..90, longitude -180..180, accuracy > 0 and <= 20 m.
 * Coordinates are rounded to 7 decimals (about 1 cm) and the accuracy to 2, exactly what is stored.
 * There is no manual-location and no IP-based fallback.
 */
export function parseGpsFix(input: unknown): GpsFix {
  const fix = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const { latitude, longitude, accuracyMeters } = fix;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!finite(latitude) || !finite(longitude) || !finite(accuracyMeters)) throw schoolError('INVALID_GPS_COORDINATES');
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || accuracyMeters <= 0) throw schoolError('INVALID_GPS_COORDINATES');
  if (accuracyMeters > GPS_MAX_ACCURACY_METERS) throw schoolError('GPS_ACCURACY_EXCEEDS_LIMIT');
  return { latitude: round(latitude, 7), longitude: round(longitude, 7), accuracyMeters: round(accuracyMeters, 2) };
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Pick<GpsFix, 'latitude' | 'longitude'>, b: Pick<GpsFix, 'latitude' | 'longitude'>): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when `point` is within the 50 m geofence around the school's official GPS. */
export function isWithinSchoolGeofence(official: Pick<GpsFix, 'latitude' | 'longitude'>, point: Pick<GpsFix, 'latitude' | 'longitude'>): boolean {
  return distanceMeters(official, point) <= SCHOOL_GEOFENCE_RADIUS_METERS;
}
