import { Controller, Get, Query, Req } from '@nestjs/common';
import { CurrencyService } from './currency.service';

@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // Auto-detects the visitor's country from their IP and returns the currency
  // + QAR conversion rate they should see prices in.
  @Get('detect')
  async detect(@Req() req: any) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    const data = await this.currencyService.detectForIp(ip);
    return { success: true, data };
  }

  // Lets the frontend override the auto-detected country (e.g. the checkout
  // address form's country field) with the same response shape as /detect.
  @Get('for-country')
  async forCountry(@Query('country') country: string) {
    const data = await this.currencyService.resolveForCountry(country);
    return { success: true, data };
  }
}
