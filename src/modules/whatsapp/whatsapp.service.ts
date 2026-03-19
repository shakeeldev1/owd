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
  private settingsCache: { whatsappEnabled: boolean; whatsappNumber: string; language?: string } | null = null;
  private settingsCacheAt = 0;
  private readonly settingsCacheTtlMs = 60000;
  private providerInactiveUntil = 0;
  private readonly providerInactiveCooldownMs = 15 * 60 * 1000;

  constructor(
    private configService: ConfigService,
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
  ) {
    const configuredApiUrl = this.configService.get('WHATSAPP_API_URL', 'https://custom1.waghl.com/send-message');
    this.apiUrl = this.normalizeApiUrl(configuredApiUrl);
    this.apiKey = this.configService.get('WHATSAPP_API_KEY', '');
    this.sender = this.configService.get('WHATSAPP_SENDER', '');
    this.defaultNumber = this.configService.get('WHATSAPP_DEFAULT_NUMBER', '+97433689955');
    const envEnabled = this.configService.get<string>('WHATSAPP_ENABLED', 'true');
    this.enabled = envEnabled !== 'false' && !!(this.apiUrl && this.apiKey && this.sender);
    this.timeoutMs = Number(this.configService.get('WHATSAPP_TIMEOUT_MS', '12000'));
  }

  private normalizeApiUrl(url: string): string {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    if (/\/send-message\/?$/i.test(trimmed)) {
      return trimmed.replace(/\/+$/, '');
    }

    return `${trimmed.replace(/\/+$/, '')}/send-message`;
  }

  private extractDefaultCountryCode(fallbackPhone: string): string {
    const digits = String(fallbackPhone || '').replace(/\D/g, '');
    if (!digits) return '974';
    if (digits.length <= 8) return '974';
    return digits.slice(0, Math.max(1, digits.length - 8));
  }

  private async getRuntimeSettings(): Promise<{ whatsappEnabled: boolean; whatsappNumber: string; language: string }> {
    const now = Date.now();
    if (this.settingsCache && now - this.settingsCacheAt < this.settingsCacheTtlMs) {
      return this.settingsCache;
    }

    try {
      const settings = await this.settingsModel.findOne().select('whatsappEnabled whatsappNumber language').lean();
      this.settingsCache = {
        whatsappEnabled: settings?.whatsappEnabled ?? true,
        whatsappNumber: settings?.whatsappNumber || this.defaultNumber,
        language: settings?.language || 'en',
      };
      this.settingsCacheAt = now;
      return this.settingsCache;
    } catch {
      return {
        whatsappEnabled: true,
        whatsappNumber: this.defaultNumber,
        language: 'en',
      };
    }
  }

  private formatPhone(phone: string, fallbackPhone: string): string {
    const source = !phone || phone.toLowerCase() === 'admin' ? fallbackPhone : phone;
    const raw = String(source).trim();
    if (!raw) return '';

    const defaultCode = this.extractDefaultCountryCode(fallbackPhone);
    if (raw.startsWith('00')) {
      return raw.slice(2).replace(/\D/g, '');
    }

    if (raw.startsWith('+')) {
      return raw.replace(/\D/g, '');
    }

    const digitsOnly = raw.replace(/\D/g, '');
    if (!digitsOnly) return '';

    if (digitsOnly.length <= 8) {
      return `${defaultCode}${digitsOnly}`;
    }

    return digitsOnly;
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
        apiKey: this.apiKey,
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

    if (Date.now() < this.providerInactiveUntil) {
      console.warn('⚠️ WhatsApp provider currently inactive. Skipping send attempt.');
      return false;
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
      const attemptSend = async (targetPhone: string) => {
        try {
          let resp = await this.postMessage(targetPhone, sanitizedMessage);
          if (!resp.ok && resp.status >= 500) {
            resp = await this.postMessage(targetPhone, sanitizedMessage);
          }

          if (!resp.ok) {
            const errText = await resp.text();
            if (errText.toLowerCase().includes('user account inactive')) {
              this.providerInactiveUntil = Date.now() + this.providerInactiveCooldownMs;
              console.error('❌ WhatsApp provider account is inactive. Disabling sends temporarily for 15 minutes.');
              return false;
            }
            console.error('❌ WhatsApp send failed:', { status: resp.status, phone: targetPhone, error: errText });
            return false;
          }

          const ct = resp.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            const data = await resp.json();
            const providerRejected = data?.success === false || data?.status === false;
            if (providerRejected) {
              const providerMsg = String(data?.msg || data?.message || '').toLowerCase();
              if (providerMsg.includes('inactive')) {
                this.providerInactiveUntil = Date.now() + this.providerInactiveCooldownMs;
                console.error('❌ WhatsApp provider account is inactive. Disabling sends temporarily for 15 minutes.');
                return false;
              }
              console.error('❌ WhatsApp provider rejected message:', data);
              return false;
            }
          }

          console.log(`✅ WhatsApp sent to ${targetPhone}`);
          return true;
        } catch (err: any) {
          console.error('❌ WhatsApp error:', err?.message || err);
          return false;
        }
      };

      const primaryOk = await attemptSend(formattedPhone);

      // Also send a copy to the admin/store WhatsApp number if different
      const adminRaw = runtime.whatsappNumber || this.defaultNumber;
      const adminFormatted = this.formatPhone(adminRaw, this.defaultNumber);
      let adminOk = false;
      if (adminFormatted && this.isValidPhone(adminFormatted) && adminFormatted !== formattedPhone) {
        adminOk = await attemptSend(adminFormatted);
      }

      return primaryOk || adminOk;
    } catch (error: any) {
      console.error('❌ WhatsApp error:', error?.message || error);
      return false;
    }
  }

  // Order lifecycle messages
  async sendOrderConfirmation(phone: string, name: string, orderNumber: string, total: number): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    if (lang === 'ar') {
      const msg = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n\n💰 الإجمالي: ${total} ريال\n\nسيتم إشعارك بجميع التحديثات.`;
      return this.sendMessage(phone, msg);
    }

    const msg = `🧾 Your Order Receipt – Oud Al Zubarah\n\nThank you for your order 🌿\nYour order has been received successfully.\n\n📦 Order ID: ${orderNumber}\n\n💰 Total: ${total} QAR\n\nYou will receive updates about your order.`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderProcessing(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    if (lang === 'ar') {
      const msg = `طلبك الآن قيد التجهيز ✨\nنعمل على تحضيره بأعلى جودة.\n\nسيتم إشعارك عند خروجه للتوصيل.`;
      return this.sendMessage(phone, msg);
    }

    const msg = `Your order is now being prepared ✨\nWe are preparing it with the highest quality.\n\nYou will be notified when it is out for delivery.`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderShipped(phone: string, name: string, orderNumber: string, trackingNumber?: string, driverPhone?: string, location?: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    if (lang === 'ar') {
      let msg = `🚚 طلبك في الطريق إليك الآن\n\n`;
      if (driverPhone) msg += `📞 رقم المندوب: ${driverPhone}\n`;
      if (location) msg += `📍 الموقع: ${location}\n`;
      msg += `\nشكرًا لاختيارك عود الزباره 🌿`;
      return this.sendMessage(phone, msg);
    }

    let msg = `🚚 Your order is on the way\n\n`;
    if (driverPhone) msg += `📞 Driver: ${driverPhone}\n`;
    if (location) msg += `📍 Location: ${location}\n`;
    msg += `\nThank you for choosing Oud Al Zubarah 🌿`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderDelivered(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    if (lang === 'ar') {
      const msg = `تم تسليم طلبك بنجاح 🌿\n\nنتمنى أن تنال منتجات عود الزباره إعجابك 🤍`;
      return this.sendMessage(phone, msg);
    }

    const msg = `Your order has been delivered successfully 🌿\n\nWe hope you love your products from Oud Al Zubarah 🤍`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderCancelled(phone: string, name: string, orderNumber: string): Promise<boolean> {
    return this.sendMessage(phone,
      `❌ *Order Cancelled*\n\nHello ${name},\nYour order *#${orderNumber}* has been cancelled.\n\nIf you have questions, please contact us.\n\nAl Fursan Oud 🌿`
    );
  }

  // Staff notifications
  async sendNewOrderAlert(phone: string, orderNumber: string, total: number): Promise<boolean> {
    return this.sendMessage(phone,
      `🔔 *New Order!*\n\nOrder *#${orderNumber}* received.\nTotal: *${total} QAR*\n\nPlease check the admin panel.`
    );
  }

  async sendAdminOrderStatusUpdate(
    phone: string,
    orderNumber: string,
    customerName: string,
    customerPhone: string,
    status: string,
  ): Promise<boolean> {
    return this.sendMessage(
      phone,
      `📢 *Order Status Updated*\n\nOrder: *#${orderNumber}*\nCustomer: ${customerName || 'N/A'}\nPhone: ${customerPhone || 'N/A'}\nNew Status: *${status}*\nUpdated: ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Qatar' })}`,
    );
  }

  async sendDeliveryAssignment(phone: string, staffName: string, orderNumber: string, address: string): Promise<boolean> {
    return this.sendMessage(phone,
      `📋 *New Delivery Assignment*\n\nHello ${staffName},\nOrder *#${orderNumber}* assigned to you.\nAddress: ${address}\n\nPlease update status when completed.`
    );
  }

  async sendCustomerCollectionNotice(
    phone: string,
    customerName: string,
    orderNumber: string,
    staffName: string,
    staffPhone: string,
  ): Promise<boolean> {
    return this.sendMessage(
      phone,
      `🚚 *We Are On The Way*\n\nHello ${customerName},\nYour order *#${orderNumber}* has been assigned for delivery.\nDelivery Staff: ${staffName}\nContact: ${staffPhone || 'Please contact support'}\n\nThank you for choosing Al Fursan Oud 🌿`,
    );
  }

  async sendLowStockAlert(phone: string, productName: string, currentStock: number): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';

    // Out of stock
    if (currentStock <= 0) {
      if (lang === 'ar') {
        const msg = `🚫 نفاد المخزون\n\nالمنتج: ${productName}\n\nالكمية الحالية: 0\n\nيرجى إعادة التوريد فورًا.`;
        return this.sendMessage(phone, msg);
      }

      const msg = `🚫 Out of Stock\n\nProduct: ${productName}\n\nCurrent Quantity: 0\n\nPlease restock immediately.`;
      return this.sendMessage(phone, msg);
    }

    // Low stock (threshold example: <=10)
    if (currentStock <= 10) {
      if (lang === 'ar') {
        const msg = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}\n\nيرجى إعادة التوريد قريبًا.`;
        return this.sendMessage(phone, msg);
      }

      const msg = `⚠️ Low Stock Alert\n\nProduct: ${productName}\nRemaining: ${currentStock}\n\nPlease restock soon.`;
      return this.sendMessage(phone, msg);
    }

    // Fallback: still send a gentle low-stock notice in default language
    if (lang === 'ar') {
      const msg = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}`;
      return this.sendMessage(phone, msg);
    }
    return this.sendMessage(phone, `⚠️ Low Stock Alert\n\nProduct: ${productName}\nRemaining: ${currentStock}`);
  }

  async sendFeedbackRequest(phone: string, name: string, orderNumber: string, googleReviewLink: string, lang?: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const L = lang || (runtime as any).language || 'en';
    if (L === 'ar') {
      const msg = `كيف كانت تجربتك مع عود الزباره؟ 🌿\n\nرأيك يهمنا كثيرًا\n\n⭐⭐⭐⭐⭐\n\nشاركنا تقييمك من هنا:\n${googleReviewLink}\n\n🎁 ستحصل على عرض خاص بعد التقييم`;
      return this.sendMessage(phone, msg);
    }

    const msg = `How was your experience with Oud Al Zubarah? 🌿\n\nYour feedback means a lot to us\n\n⭐⭐⭐⭐⭐\n\nLeave your review here:\n${googleReviewLink}\n\n🎁 You’ll receive a special offer after your review`;
    return this.sendMessage(phone, msg);
  }

  async sendPaymentReceipt(
    phone: string,
    name: string,
    orderNumber: string,
    total: number,
    paymentMethod: string,
    items: Array<{ name?: string; quantity?: number }>,
    lang?: string,
  ): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const L = lang || (runtime as any).language || 'en';
    const lines = (items || [])
      .slice(0, 20)
      .map((item) => `• ${item?.name || 'Item'} x${item?.quantity || 0}`)
      .join('\n');

    if (L === 'ar') {
      const msg = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n🛍️ المنتجات:\n${lines}\n\n💰 الإجمالي: ${total} ريال\n💳 طريقة الدفع: ${paymentMethod}\n\nسيتم إشعارك بجميع التحديثات.`;
      return this.sendMessage(phone, msg);
    }

    const msg = `🧾 Your Order Receipt – Oud Al Zubarah\n\nThank you for your order 🌿\nYour order has been received successfully.\n\n📦 Order ID: ${orderNumber}\n🛍️ Items:\n${lines}\n\n💰 Total: ${total} QAR\n💳 Payment Method: ${paymentMethod}\n\nYou will receive updates about your order.`;
    return this.sendMessage(phone, msg);
  }

  async sendPromotion(phone: string, name: string, message: string): Promise<boolean> {
    return this.sendMessage(phone,
      `🎉 *Special Offer!*\n\nHello ${name},\n${message}\n\nAl Fursan Oud 🌿`
    );
  }

  async sendLoyaltyUpdate(phone: string, name: string, points: number, tier: string): Promise<boolean> {
    return this.sendMessage(phone,
      `🏆 *Loyalty Update*\n\nHello ${name},\nYou now have *${points} points*!\nTier: *${tier}*\n\nKeep shopping to earn more rewards! 🌿`
    );
  }

  async sendInventorySummary(phone: string, items: Array<{ name: string; stock: number }>, lang?: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const L = lang || runtime.language || 'en';
    const lines = (items || []).slice(0, 50).map((it) => `• ${it.name}: ${it.stock}`).join('\n') || 'No low-stock items';

    if (L === 'ar') {
      const msg = `تقرير المخزون\n\nالعناصر ذات المخزون المنخفض:\n${lines}\n\nالرجاء إعادة التوريد عند الحاجة.`;
      return this.sendMessage(phone, msg);
    }

    const msg = `Inventory Summary\n\nLow-stock items:\n${lines}\n\nPlease restock as needed.`;
    return this.sendMessage(phone, msg);
  }
}
