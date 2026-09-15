import { findIndianCityByName } from '../data/indianLocations';

/**
 * Normalizes city names deterministically to eliminate aliasing discrepancies
 * (e.g., "Bangalore" vs "Bengaluru", "Bombay" vs "Mumbai", "BLR" vs "Bengaluru").
 */
export function normalizeCityName(city: string | undefined): string {
  if (!city) return '';
  const trimmed = city.trim();
  if (!trimmed) return '';

  const matchedCity = findIndianCityByName(trimmed);
  if (matchedCity) {
    return matchedCity.name.trim().toLowerCase();
  }

  // Fallback normalization: strip special characters, collapse spaces, lowercase
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns all search variations and aliases for a city in lowercase.
 * e.g., "Bengaluru" -> ["bengaluru", "bangalore", "bengaluru urban", "blr"]
 */
export function getCitySearchTerms(city: string | undefined): string[] {
  if (!city) return [];
  const terms = new Set<string>();

  const norm = normalizeCityName(city);
  if (norm) terms.add(norm);

  const rawLower = city.trim().toLowerCase();
  if (rawLower) terms.add(rawLower);

  const matchedCity = findIndianCityByName(city);
  if (matchedCity) {
    terms.add(matchedCity.name.toLowerCase());
    if (matchedCity.aliases) {
      matchedCity.aliases.forEach((alias) => {
        if (alias && alias.trim()) {
          terms.add(alias.trim().toLowerCase());
        }
      });
    }
  }

  return Array.from(terms).filter(Boolean);
}
