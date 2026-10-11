/**
 * Reference seed for V1 (Master Specification §90: only necessary reference data).
 *
 * IMPORTANT: this is deliberately NOT a complete geography dataset. It contains the country (Egypt) and its 27
 * governorates only. Centers, cities and villages are NOT included, were not invented, and must be loaded later from a
 * trustworthy source. The order below fixes the generated codes (GOV-000001 ...), so every fresh environment gets the
 * same codes.
 */
export const EGYPT_COUNTRY_NAME = 'مصر';

export const EGYPT_GOVERNORATE_NAMES: readonly string[] = Object.freeze([
  'القاهرة',
  'الإسكندرية',
  'بورسعيد',
  'السويس',
  'دمياط',
  'الدقهلية',
  'الشرقية',
  'القليوبية',
  'كفر الشيخ',
  'الغربية',
  'المنوفية',
  'البحيرة',
  'الإسماعيلية',
  'الجيزة',
  'بني سويف',
  'الفيوم',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'أسوان',
  'الأقصر',
  'البحر الأحمر',
  'الوادي الجديد',
  'مطروح',
  'شمال سيناء',
  'جنوب سيناء',
]);
