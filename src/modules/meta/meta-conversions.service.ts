import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { OrderDocument } from '../orders/schemas/order.schema';

export interface MetaCapiUserData {
  email?: string;
  phone?: string;
  externalId?: string;
}

export interface MetaCapiCustomData {
  currency?: string;
  value?: number;
  content_ids?: string[];
  content_type?: string;
  content_name?: string;
  contents?: Array<{ id: string; quantity: number; item_price?: number }>;
  order_id?: string;
}

const ALLOWED_EVENT_NAMES = new Set([
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'Purchase',
]);

@Injectable()
export class MetaConversionsService {
  constructor(private configService: ConfigService) {}

  private get pixelId(): string {
    return (this.configService.get<string>('META_PIXEL_ID') || '').trim();
  }

  private get accessToken(): string {
    return (this.configService.get<string>('META_CAPI_ACCESS_TOKEN') || '').trim();
  }

  private get isConfigured(): boolean {
    return Boolean(this.pixelId && this.accessToken);
  }

  private hash(value?: string): string | undefined {
    const normalized = (value || '').trim().toLowerCase();
    if (!normalized) return undefined;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  async sendEvent(params: {
    eventName: string;
    eventId: string;
    customData: MetaCapiCustomData;
    userData?: MetaCapiUserData;
    eventSourceUrl?: string;
    clientIpAddress?: string;
    clientUserAgent?: string;
  }): Promise<void> {
    if (!ALLOWED_EVENT_NAMES.has(params.eventName)) return;
    if (!this.isConfigured) return;

    const hashedEmail = this.hash(params.userData?.email);
    const hashedPhone = this.hash(params.userData?.phone);

    const body = {
      data: [
        {
          event_name: params.eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: params.eventId,
          action_source: 'website',
          event_source_url: params.eventSourceUrl,
          user_data: {
            ...(hashedEmail ? { em: [hashedEmail] } : {}),
            ...(hashedPhone ? { ph: [hashedPhone] } : {}),
            ...(params.userData?.externalId ? { external_id: [params.userData.externalId] } : {}),
            ...(params.clientIpAddress ? { client_ip_address: params.clientIpAddress } : {}),
            ...(params.clientUserAgent ? { client_user_agent: params.clientUserAgent } : {}),
          },
          custom_data: params.customData,
        },
      ],
    };

    try {
      const response = await fetch(
        `https://graph.facebook.com/v19.0/${this.pixelId}/events?access_token=${encodeURIComponent(this.accessToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error('[Meta CAPI] Event send failed:', response.status, errorText);
      }
    } catch (error: any) {
      console.error('[Meta CAPI] Event send error:', error?.message || error);
    }
  }

  async sendPurchaseEvent(
    order: OrderDocument,
    context?: { clientIpAddress?: string; clientUserAgent?: string; eventSourceUrl?: string },
  ): Promise<void> {
    if (!this.isConfigured) return;

    const eventId = (order as any).metaEventId;
    if (!eventId) return;

    const items = order.items as any[];
    const contentIds = items.map((item) => item.sku || String(item.product)).filter(Boolean);

    await this.sendEvent({
      eventName: 'Purchase',
      eventId,
      customData: {
        currency: 'QAR',
        value: order.total,
        content_ids: contentIds,
        content_type: 'product',
        contents: items.map((item) => ({
          id: item.sku || String(item.product),
          quantity: item.quantity,
          item_price: item.price,
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
