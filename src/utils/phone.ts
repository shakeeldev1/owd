/**
 * Normalize a phone number to the format: +974XXXXXXXX
 * Supports formats like:
 * - 5555 0000 (local format)
 * - +974 5555 0000 (with country code)
 * - 00974 5555 0000 (international format)
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';
  
  // Remove spaces, dashes, and other non-digit chars (but keep + at start)
  let normalized = phone.trim().replace(/[\s-]/g, '');
  
  // If starts with +974, remove the +
  if (normalized.startsWith('+974')) {
    normalized = normalized.slice(1);
  }
  
  // If starts with 00974, remove the 00
  if (normalized.startsWith('00974')) {
    normalized = normalized.slice(2);
  }
  
  // Get digits only
  const digitsOnly = normalized.replace(/\D/g, '');
  
  // If 8 digits (local), prepend 974
  if (digitsOnly.length === 8) {
    return `+974${digitsOnly}`;
  }
  
  // If 10 digits (with 974 but no +), prepend +
  if (digitsOnly.length === 10 && digitsOnly.startsWith('974')) {
    return `+${digitsOnly}`;
  }
  
  // If already has country code, add +
  if (digitsOnly.length >= 10) {
    return `+${digitsOnly}`;
  }
  
  return `+974${digitsOnly}`;
}

/**
 * Extract just the digits from a phone number
 */
export function extractPhoneDigits(phone: string): string {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

/**
 * Check if a phone number is valid for Qatar
 */
export function isValidQatarPhone(phone: string): boolean {
  if (!phone) return false;
  const digits = extractPhoneDigits(phone);
  // Qatar numbers are typically 8 digits (local) or 11 digits (with country code 974)
  return digits.length === 8 || (digits.length === 11 && digits.startsWith('974'));
}
