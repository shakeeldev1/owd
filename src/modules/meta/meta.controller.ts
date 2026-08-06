import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { MetaConversionsService } from './meta-conversions.service';
import { TrackCapiEventDto } from './dto/track-capi-event.dto';

@Controller('meta')
export class MetaController {
  constructor(private metaConversionsService: MetaConversionsService) {}

  // Public relay used by the storefront to mirror pixel events (ViewContent, AddToCart,
  // InitiateCheckout) server-side via the Conversions API, using the same eventId as the
  // pixel call for Meta-side deduplication. Purchase is sent directly from OrdersService.
  @Post('capi-events')
  async trackEvent(
    @Body() dto: TrackCapiEventDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.metaConversionsService.sendEvent({
      eventName: dto.eventName,
      eventId: dto.eventId,
      customData: dto.params || {},
      userData: dto.userData,
      eventSourceUrl: dto.eventSourceUrl,
      clientIpAddress: ip,
      clientUserAgent: userAgent,
    });
    return { message: 'ok' };
  }
}
