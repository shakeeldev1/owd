import { Injectable, Logger } from '@nestjs/common';

interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

interface CachedGeo {
  countryCode: string;
  fetchedAt: number;
}

export interface CurrencyResolution {
  country: string;
  currency: string;
  // QAR -> currency multiplier. Null means we couldn't resolve a rate — the
  // caller should skip showing a converted price rather than show a wrong number.
  rate: number | null;
  base: 'QAR';
  updatedAt: string | null;
}

const RATES_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const GEO_TTL_MS = 60 * 60 * 1000; // 1 hour
const RATES_URL = 'https://open.er-api.com/v6/latest/QAR';
const GEO_URL = (ip: string) => `http://ip-api.com/json/${ip}?fields=status,countryCode`;

// ISO 3166-1 alpha-2 country code -> ISO 4217 currency code.
// To support a new country/currency, just add an entry here.
const COUNTRY_CURRENCY_MAP: Record<string, string> = {
  QA: 'QAR',
  AE: 'AED',
  SA: 'SAR',
  KW: 'KWD',
  BH: 'BHD',
  OM: 'OMR',
  US: 'USD',
  GB: 'GBP',
  IN: 'INR',
  PK: 'PKR',
  EG: 'EGP',
  JO: 'JOD',
  LB: 'LBP',
  TR: 'TRY',
  CA: 'CAD',
  AU: 'AUD',
  FR: 'EUR',
  DE: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  IE: 'EUR',
  PT: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  FI: 'EUR',
  GR: 'EUR',
};

// The checkout page's manual country dropdown uses full names rather than ISO codes.
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  qatar: 'QA',
  'saudi arabia': 'SA',
  uae: 'AE',
  'united arab emirates': 'AE',
  kuwait: 'KW',
  bahrain: 'BH',
  oman: 'OM',
};

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private ratesCache: CachedRates | null = null;
  private readonly geoCache = new Map<string, CachedGeo>();

  private async getRates(): Promise<Record<string, number>> {
    const now = Date.now();
    if (this.ratesCache && now - this.ratesCache.fetchedAt < RATES_TTL_MS) {
      return this.ratesCache.rates;
    }

    try {
      const response = await fetch(RATES_URL);
      const json: any = await response.json();
      if (json?.result === 'success' && json?.rates) {
        this.ratesCache = { rates: json.rates, fetchedAt: now };
        return json.rates;
      }
      throw new Error('Unexpected exchange rate response shape');
    } catch (err: any) {
      this.logger.warn(`Failed to refresh exchange rates: ${err?.message}`);
      // Serve the last known rates rather than breaking price display over a blip.
      return this.ratesCache?.rates || {};
    }
  }

  private normalizeCountryCode(countryInput: string): string {
    const raw = String(countryInput || '').trim();
    if (!raw) return 'QA';
    if (raw.length === 2) return raw.toUpperCase();
    return COUNTRY_NAME_TO_CODE[raw.toLowerCase()] || 'QA';
  }

  private isPrivateOrLocalIp(ip: string): boolean {
    if (!ip) return true;
    const clean = ip.replace('::ffff:', '');
    return (
      clean === '::1'
      || clean.startsWith('127.')
      || clean.startsWith('10.')
      || clean.startsWith('192.168.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(clean)
    );
  }

  async getCountryFromIp(ip: string): Promise<string> {
    if (this.isPrivateOrLocalIp(ip)) return 'QA';

    const cached = this.geoCache.get(ip);
    if (cached && Date.now() - cached.fetchedAt < GEO_TTL_MS) {
      return cached.countryCode;
    }

    try {
      const response = await fetch(GEO_URL(ip));
      const json: any = await response.json();
      const countryCode = json?.status === 'success' && json?.countryCode ? json.countryCode : 'QA';
      this.geoCache.set(ip, { countryCode, fetchedAt: Date.now() });
      return countryCode;
    } catch (err: any) {
      this.logger.warn(`IP geolocation lookup failed for ${ip}: ${err?.message}`);
      return 'QA';
    }
  }

  async resolveForCountry(countryInput: string): Promise<CurrencyResolution> {
    const countryCode = this.normalizeCountryCode(countryInput);
    const currency = COUNTRY_CURRENCY_MAP[countryCode] || 'QAR';
    const rates = currency === 'QAR' ? null : await this.getRates();
    const rate = currency === 'QAR' ? 1 : (Number(rates?.[currency]) || null);

    return {
      country: countryCode,
      currency,
      rate,
      base: 'QAR',
      updatedAt: this.ratesCache ? new Date(this.ratesCache.fetchedAt).toISOString() : null,
    };
  }

  async detectForIp(ip: string): Promise<CurrencyResolution> {
    const countryCode = await this.getCountryFromIp(ip);
    return this.resolveForCountry(countryCode);
  }
}
