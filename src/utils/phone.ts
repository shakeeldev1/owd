/**
 * Normalize a phone number to digits-only format: 974XXXXXXXX
 * Supports formats like:
 * - 5555 0000 (local format)
 * - +974 5555 0000 (with country code)
 * - 00974 5555 0000 (international format)
 */
export function normalizePhone(phone: string): string {
  if (!phone) return '';

  // Remove all non-digit characters including '+'.
  let digitsOnly = phone.trim().replace(/\D/g, '');

  if (!digitsOnly) return '';

  // Convert 00974XXXXXXXX to 974XXXXXXXX
  if (digitsOnly.startsWith('00974')) {
    digitsOnly = digitsOnly.slice(2);
  }

  // Convert generic international prefix 00XXXXXXXX to XXXXXX
  if (digitsOnly.startsWith('00')) {
    digitsOnly = digitsOnly.slice(2);
  }

  // Common local formatting: 0XXXXXXXX -> XXXXXXXX
  if (digitsOnly.length === 9 && digitsOnly.startsWith('0')) {
    digitsOnly = digitsOnly.slice(1);
  }

  // If 8 digits (local), prepend Qatar country code
  if (digitsOnly.length === 8) {
    return `974${digitsOnly}`;
  }

  // Already international-style digits
  if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    return digitsOnly;
  }

  // Fallback for short/partial input
  return `974${digitsOnly}`;
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
