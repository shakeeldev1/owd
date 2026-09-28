import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { OrderDocument } from '../orders/schemas/order.schema';

interface TikTokUserData {
  email?: string;
  phone?: string;
  externalId?: string;
}

interface TikTokEventParams {
  currency?: string;
  value?: number;
  content_id?: string;
  content_ids?: string[];
  content_type?: string;
  content_name?: string;
  contents?: Array<{ content_id: string; content_type?: string; quantity: number; price?: number }>;
  order_id?: string;
}

const ALLOWED_EVENT_NAMES = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);

@Injectable()
export class TikTokService {
  constructor(private configService: ConfigService) {}

  private get pixelId(): string {
    return (this.configService.get<string>('TIKTOK_PIXEL_ID') || '').trim();
  }

  private get accessToken(): string {
    return (this.configService.get<string>('TIKTOK_EVENTS_API_ACCESS_TOKEN') || '').trim();
  }

  private get isConfigured(): boolean {
    return Boolean(this.pixelId && this.accessToken);
  }

  private hash(value?: string): string | undefined {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  private hashPhone(value?: string): string | undefined {
    const normalized = (value || '').replace(/\D/g, '');
    if (!normalized) return undefined;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  async sendEvent(params: {
    eventName: string;
    eventId: string;
    customData: TikTokEventParams;
    userData?: TikTokUserData;
    eventSourceUrl?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
  }): Promise<void> {
    if (!ALLOWED_EVENT_NAMES.has(params.eventName) || !this.isConfigured) return;

    const body = {
      event_source: 'web',
      event_source_id: this.pixelId,
      data: [
        {
          event: params.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: params.eventId,
          user: {
            ...(this.hash(params.userData?.email) ? { email: this.hash(params.userData?.email) } : {}),
            ...(this.hashPhone(params.userData?.phone) ? { phone: this.hashPhone(params.userData?.phone) } : {}),
            ...(params.userData?.externalId ? { external_id: params.userData.externalId } : {}),
            ...(params.clientIpAddress ? { ip: params.clientIpAddress } : {}),
            ...(params.clientUserAgent ? { user_agent: params.clientUserAgent } : {}),
          },
          properties: params.customData,
          ...(params.eventSourceUrl ? { page: { url: params.eventSourceUrl } } : {}),
        },
      ],
    };

    try {
      const response = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': this.accessToken,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[TikTok Events API] Event send failed:', response.status, errorText);
      }
    } catch (error: any) {
      console.error('[TikTok Events API] Event send error:', error?.message || error);
    }
  }

  async sendPurchaseEvent(
    order: OrderDocument,
    context?: { clientIpAddress?: string; clientUserAgent?: string; eventSourceUrl?: string },
  ): Promise<void> {
    const eventId = (order as any).metaEventId;
    if (!eventId) return;

    const items = order.items as any[];
    await this.sendEvent({
      eventName: 'Purchase',
      eventId,
      customData: {
        currency: 'QAR',
        value: order.total,
        content_ids: items.map((item) => item.sku || String(item.product)).filter(Boolean),
        content_type: 'product',
        contents: items.map((item) => ({
          content_id: item.sku || String(item.product),
          content_type: 'product',
          quantity: item.quantity,
          price: item.price,
        })),
        order_id: order.orderNumber,
      },
      userData: {
        email: order.customer?.email,
        phone: order.customer?.phone,
        externalId: order.user ? String(order.user) : undefined,
      },
      eventSourceUrl: context?.eventSourceUrl,
      clientIpAddress: context?.clientIpAddress,
      clientUserAgent: context?.clientUserAgent,
    });
  }
}