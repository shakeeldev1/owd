import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { TikTokService } from './tiktok.service';
import { TrackTikTokEventDto } from './dto/track-tiktok-event.dto';

@Controller('tiktok')
export class TikTokController {
  constructor(private tikTokService: TikTokService) {}

  @Post('events')
  async trackEvent(
    @Body() dto: TrackTikTokEventDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.tikTokService.sendEvent({
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