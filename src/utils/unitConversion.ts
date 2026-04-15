/**
 * Unit Conversion Utilities
 * 
 * This module handles conversion between different units, particularly
 * converting sales units (Tola) to inventory units (Grams).
 * 
 * Key Rule: 1 Tola = 11.66 Grams
 */

export const UNIT_CONVERSION_FACTORS = {
  tola: 11.66,                    // 1 Tola = 11.66 Grams
  'quarter tola': 2.915,          // 1 Quarter Tola = 0.25 × 11.66 = 2.915 Grams
  'quarter-tola': 2.915,          // Alternative format
  piece: 1,                       // 1 Piece = 1 unit (no conversion)
  grams: 1,                       // Base unit
  ml: 1,                          // No conversion (volume-based)
  kg: 1000,                       // 1 kg = 1000 grams (though typically stored as grams)
} as const;

/**
 * Convert sales quantity to base inventory quantity (Grams)
 * @param quantity - The quantity in the sales unit
 * @param unit - The unit type (tola, piece, grams, ml, kg)
 * @returns The equivalent quantity in Grams (base inventory unit)
 * 
 * @example
 * convertToGrams(1, 'tola') // returns 11.66
 * convertToGrams(5, 'piece') // returns 5
 * convertToGrams(100, 'grams') // returns 100
 */
export function convertToGrams(quantity: number, unit?: string): number {
  if (!unit || !quantity) return quantity;
  
  const normalizedUnit = (unit || 'grams').toLowerCase().trim();
  const factor = UNIT_CONVERSION_FACTORS[normalizedUnit as keyof typeof UNIT_CONVERSION_FACTORS];
  
  if (factor === undefined) {
    // Unknown unit, assume no conversion needed
    return quantity;
  }
  
  return quantity * factor;
}

/**
 * Check if a unit requires conversion from sales units to base inventory units
 * @param unit - The unit type
 * @returns true if this unit requires conversion, false otherwise
 */
export function requiresConversion(unit?: string): boolean {
  if (!unit) return false;
  const normalizedUnit = unit.toLowerCase().trim();
  return normalizedUnit === 'tola' || normalizedUnit === 'kg';
}

/**
 * Get display name for unit
 * @param unit - The unit type
 * @returns Localized display name (Arabic for tola)
 */
export function getUnitDisplayName(unit?: string): string {
  if (!unit) return 'Units';
  
  const names: Record<string, string> = {
    tola: 'تولة',      // Arabic name for Tola
    piece: 'حبة',       // Arabic name for Piece
    grams: 'جرام',      // Grams
    ml: 'ملل',          // Milliliters
    kg: 'كيلو',         // Kilogram
  };
  
  const normalizedUnit = unit.toLowerCase().trim();
  return names[normalizedUnit] || unit;
}

/**
 * Validate that quantity is appropriate for the unit
 */
export function isValidQuantity(quantity: number, unit?: string): boolean {
  if (typeof quantity !== 'number' || quantity <= 0) return false;
  
  // Tola quantities should be reasonable (e.g., not more than 1000)
  // Piece quantities should be whole numbers
  if (unit?.toLowerCase() === 'piece' && !Number.isInteger(quantity)) {
    return false;
  }
  
  return true;
}
