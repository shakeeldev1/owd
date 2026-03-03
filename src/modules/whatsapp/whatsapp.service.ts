import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, SettingsDocument } from '../settings/settings.schema';

export interface WhatsAppMessage {
  to: string;
  template?: string;
  text?: string;
  params?: Record<string, string>;
}

@Injectable()
export class WhatsAppService {
  private apiUrl: string;
  private apiKey: string;
  private sender: string;
  private defaultNumber: string;
  private enabled: boolean;
  private readonly timeoutMs: number;
  private readonly maxMessageLength = 4096;
  private settingsCache: { whatsappEnabled: boolean; whatsappNumber: string } | null = null;
  private settingsCacheAt = 0;
  private readonly settingsCacheTtlMs = 60000;

  constructor(
    private configService: ConfigService,
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
  ) {
    this.apiUrl = this.configService.get('WHATSAPP_API_URL', 'https://custom1.waghl.com/send-message');
    this.apiKey = this.configService.get('WHATSAPP_API_KEY', '');
    this.sender = this.configService.get('WHATSAPP_SENDER', '');
    this.defaultNumber = this.configService.get('WHATSAPP_DEFAULT_NUMBER', '+97433689955');
    const envEnabled = this.configService.get<string>('WHATSAPP_ENABLED', 'true');
    this.enabled = envEnabled !== 'false' && !!(this.apiUrl && this.apiKey && this.sender);
    this.timeoutMs = Number(this.configService.get('WHATSAPP_TIMEOUT_MS', '12000'));
  }

  private async getRuntimeSettings(): Promise<{ whatsappEnabled: boolean; whatsappNumber: string }> {
    const now = Date.now();
    if (this.settingsCache && now - this.settingsCacheAt < this.settingsCacheTtlMs) {
      return this.settingsCache;
    }

    try {
      const settings = await this.settingsModel.findOne().select('whatsappEnabled whatsappNumber').lean();
      this.settingsCache = {
        whatsappEnabled: settings?.whatsappEnabled ?? true,
        whatsappNumber: settings?.whatsappNumber || this.defaultNumber,
      };
      this.settingsCacheAt = now;
      return this.settingsCache;
    } catch {
      return {
        whatsappEnabled: true,
        whatsappNumber: this.defaultNumber,
      };
    }
  }

  private formatPhone(phone: string, fallbackPhone: string): string {
    const source = !phone || phone.toLowerCase() === 'admin' ? fallbackPhone : phone;
    let cleaned = String(source).trim().replace(/[\s\-\(\)]/g, '');
    if (!cleaned.startsWith('+') && !cleaned.startsWith('00')) cleaned = `+974${cleaned}`;
    if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
    return cleaned.replace(/\D/g, '');
  }

  private sanitizeMessage(message: string): string {
    const safeMessage = (message || '').trim();
    if (!safeMessage) return '';
    if (safeMessage.length <= this.maxMessageLength) return safeMessage;
    return `${safeMessage.slice(0, this.maxMessageLength - 3)}...`;
  }

  private isValidPhone(formattedPhone: string): boolean {
    return /^\d{8,15}$/.test(formattedPhone);
  }

  private async postMessage(number: string, message: string): Promise<Response> {
    return fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        sender: this.sender,
        number,
        message,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();

    if (!runtime.whatsappEnabled) {
      console.log(`📱 [WhatsApp Disabled in Settings] To: ${phone}`);
      return true;
    }

    if (!this.enabled) {
      console.log(`📱 [WhatsApp Disabled by Env] To: ${phone}`);
      return true;
    }

    const sanitizedMessage = this.sanitizeMessage(message);
    if (!sanitizedMessage) {
      console.warn('⚠️ WhatsApp message skipped: empty message payload');
      return false;
    }

    const formattedPhone = this.formatPhone(phone, runtime.whatsappNumber || this.defaultNumber);
    if (!this.isValidPhone(formattedPhone)) {
      console.warn(`⚠️ WhatsApp message skipped: invalid phone ${phone}`);
      return false;
    }

    try {
      let response = await this.postMessage(formattedPhone, sanitizedMessage);
      if (!response.ok && response.status >= 500) {
        response = await this.postMessage(formattedPhone, sanitizedMessage);
      }

      if (!response.ok) {
        const error = await response.text();
        console.error('❌ WhatsApp send failed:', {
          status: response.status,
          phone: formattedPhone,
          error,
        });
        return false;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data?.success === false) {
          console.error('❌ WhatsApp provider rejected message:', data);
          return false;
        }
      }

      console.log(`✅ WhatsApp sent to ${formattedPhone}`);
      return true;
    } catch (error: any) {
      console.error('❌ WhatsApp error:', error?.message || error);
      return false;
    }
  }

  // Order lifecycle messages
  async sendOrderConfirmation(phone: string, name: string, orderNumber: string, total: number): Promise<void> {
    await this.sendMessage(phone, 
      `🛍️ *Order Confirmed!*\n\nHello ${name},\nYour order *#${orderNumber}* has been placed successfully.\nTotal: *${total} QAR*\n\nThank you for shopping with Al Fursan Oud! 🌿`
    );
  }

  async sendOrderProcessing(phone: string, name: string, orderNumber: string): Promise<void> {
    await this.sendMessage(phone,
      `📦 *Order Being Prepared*\n\nHello ${name},\nYour order *#${orderNumber}* is now being prepared.\n\nWe'll notify you when it's ready for delivery! 🌿`
    );
  }

  async sendOrderShipped(phone: string, name: string, orderNumber: string, trackingNumber?: string): Promise<void> {
    let msg = `🚚 *Out for Delivery!*\n\nHello ${name},\nYour order *#${orderNumber}* is on its way!`;
    if (trackingNumber) msg += `\nTracking: *${trackingNumber}*`;
    msg += `\n\nAl Fursan Oud 🌿`;
    await this.sendMessage(phone, msg);
  }

  async sendOrderDelivered(phone: string, name: string, orderNumber: string): Promise<void> {
    await this.sendMessage(phone,
      `✅ *Order Delivered!*\n\nHello ${name},\nYour order *#${orderNumber}* has been delivered.\n\nWe hope you enjoy your purchase! Please rate your experience.\n\nAl Fursan Oud 🌿`
    );
  }

  async sendOrderCancelled(phone: string, name: string, orderNumber: string): Promise<void> {
    await this.sendMessage(phone,
      `❌ *Order Cancelled*\n\nHello ${name},\nYour order *#${orderNumber}* has been cancelled.\n\nIf you have questions, please contact us.\n\nAl Fursan Oud 🌿`
    );
  }

  // Staff notifications
  async sendNewOrderAlert(phone: string, orderNumber: string, total: number): Promise<void> {
    await this.sendMessage(phone,
      `🔔 *New Order!*\n\nOrder *#${orderNumber}* received.\nTotal: *${total} QAR*\n\nPlease check the admin panel.`
    );
  }

  async sendDeliveryAssignment(phone: string, staffName: string, orderNumber: string, address: string): Promise<void> {
    await this.sendMessage(phone,
      `📋 *New Delivery Assignment*\n\nHello ${staffName},\nOrder *#${orderNumber}* assigned to you.\nAddress: ${address}\n\nPlease update status when completed.`
    );
  }

  async sendLowStockAlert(phone: string, productName: string, currentStock: number): Promise<void> {
    await this.sendMessage(phone,
      `⚠️ *Low Stock Alert*\n\n*${productName}* has only *${currentStock}* items left.\n\nPlease restock soon.`
    );
  }

  async sendFeedbackRequest(phone: string, name: string, orderNumber: string, googleReviewLink: string): Promise<void> {
    await this.sendMessage(phone,
      `⭐ *How was your experience?*\n\nHello ${name},\nWe'd love your feedback on order *#${orderNumber}*.\n\nLeave a review: ${googleReviewLink}\n\nThank you! 🌿`
    );
  }

  async sendPaymentReceipt(
    phone: string,
    name: string,
    orderNumber: string,
    total: number,
    paymentMethod: string,
    items: Array<{ name?: string; quantity?: number }>,
  ): Promise<void> {
    const lines = (items || [])
      .slice(0, 8)
      .map((item) => `• ${item?.name || 'Item'} x${item?.quantity || 0}`)
      .join('\n');

    await this.sendMessage(
      phone,
      `🧾 *Payment Receipt*\n\nHello ${name},\nPayment has been completed for order *#${orderNumber}*.\n\n${lines}\n\n*Total:* ${total} QAR\n*Payment Method:* ${paymentMethod}\n\nThank you for choosing Al Fursan Oud 🌿`,
    );
  }

  async sendPromotion(phone: string, name: string, message: string): Promise<void> {
    await this.sendMessage(phone,
      `🎉 *Special Offer!*\n\nHello ${name},\n${message}\n\nAl Fursan Oud 🌿`
    );
  }

  async sendLoyaltyUpdate(phone: string, name: string, points: number, tier: string): Promise<void> {
    await this.sendMessage(phone,
      `🏆 *Loyalty Update*\n\nHello ${name},\nYou now have *${points} points*!\nTier: *${tier}*\n\nKeep shopping to earn more rewards! 🌿`
    );
  }
}
