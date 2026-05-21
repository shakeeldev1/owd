import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, SettingsDocument } from '../settings/settings.schema';
import { normalizePhone } from '../../utils/phone';

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
  private settingsCache: { whatsappEnabled: boolean; whatsappNumber: string; language: string } | null = null;
  private settingsCacheAt = 0;
  private readonly settingsCacheTtlMs = 5000; // Reduced from 60000 for faster updates
  private providerInactiveUntil = 0;
  private readonly providerInactiveCooldownMs = 15 * 60 * 1000;

  constructor(
    private configService: ConfigService,
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
  ) {
    const configuredApiUrl = this.getConfigValue(
      ['MESSAGING_API_URL', 'WHATSAPP_API_URL', 'WHATSAPP_BASE_URL'],
      'https://custom2.waghl.com/',
    );
    this.apiUrl = this.normalizeApiUrl(configuredApiUrl);
    this.apiKey = this.getConfigValue(['WHATSAPP_API_KEY', 'MESSAGING_API_KEY'], '');
    this.sender = this.normalizeSender(this.getConfigValue(['WHATSAPP_SENDER', 'MESSAGING_SENDER'], ''));
    this.defaultNumber = this.normalizeDigits(this.getConfigValue(['WHATSAPP_NUMBER', 'MESSAGING_DEFAULT_NUMBER'], ''));
    const envEnabled = this.configService.get<string>('MESSAGING_ENABLED', 'true');
    this.enabled = envEnabled !== 'false' && !!(this.apiUrl && this.apiKey);
    this.timeoutMs = Number(this.configService.get('MESSAGING_TIMEOUT_MS', '12000'));
    
    // Clear cache on init
    this.settingsCache = null;
    this.settingsCacheAt = 0;
    
    console.log('✅ WhatsApp Service Initialized:', {
      senderFromEnv: this.sender,
      defaultNumber: this.defaultNumber,
      enabled: this.enabled,
    });
  }

  private normalizeApiUrl(url: string): string {
    const trimmed = String(url || '').trim();
    if (!trimmed) return '';

    if (/\/send-message\/?$/i.test(trimmed)) {
      return trimmed.replace(/\/+$/, '');
    }

    return `${trimmed.replace(/\/+$/, '')}/send-message`;
  }

  private normalizeDigits(value: string): string {
    return String(value || '').replace(/\D/g, '');
  }

  private getConfigValue(keys: string[], fallback: string): string {
    for (const key of keys) {
      const value = this.configService.get<string>(key, '');
      if (value && String(value).trim()) {
        return String(value).trim();
      }
    }

    return fallback;
  }

  private normalizeSender(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/[a-z]/i.test(raw)) return raw;
    return this.normalizeDigits(raw);
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
      // Cache is still fresh, use it
      return this.settingsCache;
    }

    try {
      const settings = await this.settingsModel.findOne().select('whatsappEnabled whatsappNumber language').lean();
      
      const whatsappNumber = settings?.whatsappNumber || this.defaultNumber;
      
      this.settingsCache = {
        whatsappEnabled: settings?.whatsappEnabled ?? true,
        whatsappNumber,
        language: settings?.language || 'en',
      };
      this.settingsCacheAt = now;
      
      console.log('📱 WhatsApp Runtime Settings Loaded:', {
        fromDB: !!settings?.whatsappNumber,
        whatsappNumber,
        whatsappEnabled: this.settingsCache.whatsappEnabled,
        cached: false,
      });
      
      return this.settingsCache;
    } catch (err: any) {
      console.warn('⚠️ Error reading WhatsApp settings from DB, using defaults:', err?.message);
      const fallback = {
        whatsappEnabled: true,
        whatsappNumber: this.defaultNumber,
        language: 'en',
      };
      console.log('Using fallback:', fallback);
      return fallback;
    }
  }

  private formatPhone(phone: string, fallbackPhone: string): string {
    const source = !phone || phone.toLowerCase() === 'admin' ? fallbackPhone : phone;
    const raw = String(source || '').trim();
    if (!raw) return '';

    const normalized = normalizePhone(raw);
    if (this.isValidPhone(normalized)) {
      return normalized;
    }

    const defaultCode = this.extractDefaultCountryCode(fallbackPhone);
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

  private resolveSender(runtime: { whatsappNumber?: string } | null): string {
    // IMPORTANT: Sender is the device token from Custom2 admin panel "View Devices" section
    // It MUST come from .env (MESSAGING_SENDER), never from whatsappNumber
    // The whatsappNumber is for receiving calls, NOT for sending
    const envSender = this.normalizeSender(this.sender);
    if (!envSender) {
      console.warn('⚠️ WARNING: No MESSAGING_SENDER found in .env. Using fallback.');
      return this.defaultNumber;
    }
    return envSender;
  }

  private isValidPhone(formattedPhone: string): boolean {
    return /^\d{8,15}$/.test(formattedPhone);
  }

  private async postMessage(number: string, message: string, sender: string): Promise<Response> {
    return fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: this.apiKey,
        sender: this.normalizeSender(sender),
        number,
        message,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async sendMessage(phone: string, message: string, options?: { mirrorToAdmin?: boolean }): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const mirrorToAdmin = options?.mirrorToAdmin === true;

    if (!runtime.whatsappEnabled) {
      console.log(`📱 [WhatsApp Disabled in Settings] To: ${phone}`);
      return false;
    }

    if (!this.enabled) {
      console.log(`📱 [WhatsApp Disabled by Env] To: ${phone}`);
      return false;
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

    const fallbackPhone = runtime.whatsappNumber || this.defaultNumber;
    const senderToUse = this.resolveSender(runtime);
    console.log('📋 WhatsApp Send Preparation:', {
      inputPhone: phone,
      isAdmin: phone?.toLowerCase() === 'admin',
      fallbackPhone,
      senderToUse,
      runtimeWhatsappNumber: runtime.whatsappNumber,
      envDefaultNumber: this.defaultNumber,
    });
    
    const formattedPhone = this.formatPhone(phone, fallbackPhone);
    if (!this.isValidPhone(formattedPhone)) {
      console.warn(`⚠️ WhatsApp message skipped: invalid phone format`, {
        originalPhone: phone,
        formattedPhone,
        fallback: fallbackPhone,
        isAdmin: phone?.toLowerCase() === 'admin'
      });
      return false;
    }

    try {
      const attemptSend = async (targetPhone: string, isAdmin: boolean = false) => {
        try {
          let resp = await this.postMessage(targetPhone, sanitizedMessage, senderToUse);
          if (!resp.ok && resp.status >= 500) {
            console.warn(`⚠️ Server error from WhatsApp API, retrying...`, { status: resp.status });
            resp = await this.postMessage(targetPhone, sanitizedMessage, senderToUse);
          }

          if (!resp.ok) {
            const errText = await resp.text();
            if (errText.toLowerCase().includes('user account inactive')) {
              this.providerInactiveUntil = Date.now() + this.providerInactiveCooldownMs;
              console.error('❌ WhatsApp provider account is inactive. Disabling sends temporarily for 15 minutes.');
              return false;
            }
            console.error('❌ WhatsApp HTTP error:', {
              type: isAdmin ? 'admin' : 'customer',
              phone: targetPhone,
              status: resp.status,
              error: errText.substring(0, 200)
            });
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
              console.error('❌ WhatsApp provider rejected message:', {
                type: isAdmin ? 'admin' : 'customer',
                phone: targetPhone,
                response: data
              });
              return false;
            }
            console.log(`✅ WhatsApp sent to ${isAdmin ? 'admin' : 'customer'}:`, targetPhone);
          } else {
            console.log(`✅ WhatsApp sent to ${isAdmin ? 'admin' : 'customer'}:`, targetPhone);
          }
          return true;
        } catch (err: any) {
          console.error('❌ WhatsApp send error:', {
            type: isAdmin ? 'admin' : 'customer',
            phone: targetPhone,
            error: err?.message || err?.toString()
          });
          return false;
        }
      };

      // Send to customer phone
      const primaryOk = await attemptSend(formattedPhone, false);

      if (!mirrorToAdmin) {
        return primaryOk;
      }
      
      // Also send to admin/store number if configured and different
      const adminRaw = runtime.whatsappNumber || this.defaultNumber;
      const adminFormatted = this.formatPhone(adminRaw, this.defaultNumber);
      let adminOk = false;
      
      console.log('📱 Admin Notification Check:', {
        adminRaw,
        adminFormatted,
        isDifferent: adminFormatted !== formattedPhone,
        isValid: this.isValidPhone(adminFormatted),
      });
      
      if (mirrorToAdmin && adminFormatted && this.isValidPhone(adminFormatted) && adminFormatted !== formattedPhone) {
        console.log(`📱 Also notifying admin/store: ${adminFormatted}`);
        adminOk = await attemptSend(adminFormatted, true);
      }

      // Log results
      if (!primaryOk && !adminOk) {
        console.warn('⚠️ WhatsApp message failed to send to both customer and admin');
      } else if (!primaryOk) {
        console.warn('⚠️ WhatsApp message sent to admin only, failed for customer');
      } else if (mirrorToAdmin && !adminOk && adminFormatted !== formattedPhone) {
        console.warn('⚠️ WhatsApp message sent to customer, failed for admin');
      }

      return primaryOk;
    } catch (error: any) {
      console.error('❌ WhatsApp error:', error?.message || error);
      return false;
    }
  }

  // Order lifecycle messages
  async sendOrderConfirmation(phone: string, name: string, orderNumber: string, total: number): Promise<boolean> {
    const ar = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n\n💰 الإجمالي: ${total} ريال قطري\n\nسيتم إشعارك بجميع التحديثات.`;
    const en = `🧾 Order Receipt – Oud Al Zubarah\n\nThank you for your order 🌿\nYour order has been received successfully.\n\n📦 Order: ${orderNumber}\n\n💰 Total: ${total} QAR\n\nYou will be notified of updates.`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendOrderProcessing(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const ar = `طلبك الآن قيد التجهيز ✨\nنعمل على تحضيره بأعلى جودة.\n\nسيتم إشعارك عند خروجه للتوصيل.`;
    const en = `Your order is now being prepared ✨\nWe are preparing it with the highest care.\n\nYou will be notified when it is out for delivery.`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendOrderShipped(phone: string, name: string, orderNumber: string, trackingNumber?: string, driverPhone?: string, location?: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    const ar = `🚚 طلبك في الطريق إليك الآن 🚚\n\nمرحبًا ${name},\nطلبك *#${orderNumber}* في طريقه للتوصيل\n${driverPhone ? `📞 رقم المندوب: ${driverPhone}\n` : ''}${location ? `📍 الموقع: ${location}\n` : ''}\nشكرًا لاختيارك عود الزباره 🌿`;
    const en = `🚚 Your order is on the way 🚚\n\nHello ${name},\nOrder #${orderNumber} is out for delivery\n${driverPhone ? `📞 Driver Phone: ${driverPhone}\n` : ''}${location ? `📍 Location: ${location}\n` : ''}\nThank you for choosing Oud Al Zubarah 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendOrderDelivered(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    const ar = `✅ تم تسليم طلبك بنجاح ✅\n\nمرحبًا ${name},\nتم تسليم طلبك *#${orderNumber}* بنجاح\n\nنأمل أن تنال منتجات عود الزباره رضاك. شكرًا لك! 🌿`;
    const en = `✅ Order Delivered Successfully ✅\n\nHello ${name},\nOrder #${orderNumber} has been delivered successfully\n\nWe hope you enjoy your purchase. Thank you! 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendOrderCancelled(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const ar = `❌ *تم إلغاء الطلب*\n\nمرحبًا ${name}،\nتم إلغاء طلبك *#${orderNumber}*.\n\nإذا كانت لديك أي استفسارات، يرجى التواصل معنا.\n\nعود الزباره 🌿`;
    const en = `❌ Order Cancelled\n\nHello ${name},\nYour Order #${orderNumber} has been cancelled.\n\nIf you have questions, please contact us.\n\nOud Al Zubarah 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  // Staff notifications
  async sendNewOrderAlert(phone: string, orderNumber: string, total: number): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const enMsg = `🔔 New Request | طلب جديد\n\nOrder #${orderNumber}\nTotal: ${total} QAR\n\n📱 Check system | راجع النظام`;
    const message = enMsg;

    // If caller requests 'admin', notify the configured admin number(s) from .env only
    if (phone && String(phone).toLowerCase() === 'admin') {
      const recipients = new Set<string>();

      // Admin recipients from env var (comma/newline/semicolon separated) - ONLY SOURCE
      const extraRaw = String(this.configService.get('WHATSAPP_ADMIN_RECIPIENTS', '') || this.configService.get('MESSAGING_ADMIN_NUMBERS', '') || '').trim();
      if (extraRaw) {
        extraRaw
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((r) => {
            const formatted = this.formatPhone(r, this.defaultNumber);
            if (formatted && this.isValidPhone(formatted)) recipients.add(formatted);
          });
      }

      const list = Array.from(recipients);
      if (list.length === 0) {
        // Nothing to send to
        console.warn('⚠️ No admin WhatsApp recipients configured. Skipping admin alert.');
        return false;
      }

      const results = await Promise.all(
        list.map(async (r) => {
          try {
            return await this.sendMessage(r, message, { mirrorToAdmin: false });
          } catch (e) {
            console.error(`❌ Failed to send to ${r}:`, e);
            return false;
          }
        }),
      );

      const successCount = results.filter((v) => !!v).length;
      const anyOk = results.some((v) => !!v);
      if (!anyOk) console.warn('⚠️ WhatsApp new-order alert failed for all admin recipients', { recipients: list });
      return anyOk;
    }

    return this.sendMessage(phone, message);
  }

  async sendAdminOrderStatusUpdate(
    phone: string,
    orderNumber: string,
    customerName: string,
    customerPhone: string,
    status: string,
  ): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Qatar' });
    
    const ar = `📢 تحديث حالة الطلب\n\nرقم الطلب: *#${orderNumber}*\nالعميل: ${customerName || 'غير محدد'}\nرقم الهاتف: ${customerPhone || 'غير محدد'}\nالحالة الجديدة: *${status}*\nالوقت: ${timestamp}`;
    const en = `📢 Order Status Update\n\nOrder: *#${orderNumber}*\nCustomer: ${customerName || 'Unknown'}\nPhone: ${customerPhone || 'Unknown'}\nNew Status: *${status}*\nTime: ${timestamp}`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendDeliveryAssignment(phone: string, staffName: string, orderNumber: string, address: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    const ar = `📋 تم تعيينك لتوصيل جديد\n\nمرحبًا ${staffName},\nتم تعيينك لتوصيل الطلب *#${orderNumber}*.\nالعنوان: ${address}\n\nيرجى تحديث الحالة عند الانتهاء.`;
    const en = `📋 New Delivery Assignment\n\nHello ${staffName},\nYou have been assigned to deliver Order #${orderNumber}.\nAddress: ${address}\n\nPlease update status after completion.`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendCustomerCollectionNotice(
    phone: string,
    customerName: string,
    orderNumber: string,
    staffName: string,
    staffPhone: string,
  ): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    const ar = `🚚 نحن في الطريق إليك 🚚\n\nمرحبًا ${customerName},\nتم تعيين المندوب لتوصيل طلبك *#${orderNumber}*\nاسم المندوب: ${staffName}\nرقم الهاتف: ${staffPhone || 'يرجى التواصل مع خدمة العملاء'}\n\nشكرًا لاختيارك عود الزباره 🌿`;
    const en = `🚚 Your order is on the way 🚚\n\nHello ${customerName},\nDelivery agent assigned for Order #${orderNumber}\nAgent Name: ${staffName}\nPhone: ${staffPhone || 'Contact Support'}\n\nThank you for choosing Oud Al Zubarah 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendLowStockAlert(phone: string, productName: string, currentStock: number): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    // Always send bilingual message: Arabic first, then English
    if (currentStock <= 0) {
      const ar = `🚫 نفاد المخزون\n\nالمنتج: ${productName}\n\nالكمية الحالية: 0\n\nيرجى إعادة التوريد فورًا.`;
      const en = `🚫 Out of Stock\n\nProduct: ${productName}\n\nCurrent Quantity: 0\n\nPlease restock immediately.`;
      return this.sendMessage(phone, `${ar}\n\n${en}`);
    }

    if (currentStock <= 10) {
      const ar = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}\n\nيرجى إعادة التوريد قريبًا.`;
      const en = `⚠️ Low Stock Alert\n\nProduct: ${productName}\nRemaining Quantity: ${currentStock}\n\nPlease restock soon.`;
      return this.sendMessage(phone, `${ar}\n\n${en}`);
    }

    // Generic fallback low-stock notice
    const ar = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}`;
    const en = `⚠️ Low Stock Alert\n\nProduct: ${productName}\nRemaining Quantity: ${currentStock}`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendFeedbackRequest(
    phone: string,
    name: string,
    orderNumber: string,
    googleReviewLink: string,
    orderId?: string,
    lang?: string,
  ): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const L = lang || (runtime as any).language || 'en';
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://oudalzubarah.com');
    const appReviewLink = orderId ? `${frontendUrl}/orders/${orderId}/review` : null;

    const arIntro = `⭐ نود معرفة رأيك ⭐\n\nمرحبًا ${name},\nشكرًا لك على شرائك من عود الزباره!\nكيف كانت تجربتك؟ 🌿\n\n`;
    const enIntro = `⭐ We'd love your feedback ⭐\n\nHello ${name},\nThank you for purchasing from Oud Al Zubarah!\nHow was your experience? 🌿\n\n`;
    const arLinks = appReviewLink ? `📱 شارك تقييمك في التطبيق:\n${appReviewLink}\n\n` : '';
    const enLinks = appReviewLink ? `📱 Leave your review in the app:\n${appReviewLink}\n\n` : '';
    const ar = `${arIntro}${arLinks}🌐 أو شارك تقييمك من هنا:\n${googleReviewLink}\n\n🎁 ستحصل على عرض خاص بعد التقييم`;
    const en = `${enIntro}${enLinks}🌐 Or share your review here:\n${googleReviewLink}\n\n🎁 Get a special offer after you review`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
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

    const ar = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n🛍️ المنتجات:\n${lines}\n\n💰 الإجمالي: ${total} ريال\n💳 طريقة الدفع: ${paymentMethod}\n\nسيتم إشعارك بجميع التحديثات.`;
    const en = `🧾 Order Receipt – Oud Al Zubarah\n\nThank you for your order 🌿\nYour order has been received successfully.\n\n📦 Order #${orderNumber}\n🛍️ Items:\n${lines}\n\n💰 Total: ${total} QAR\n💳 Payment Method: ${paymentMethod}\n\nYou will be notified of updates.`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendDeliveryReceipt(
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

    const ar = `✅ تم استلام طلبك بنجاح – عود الزباره ✅\n\nمرحبًا ${name},\nشكرًا على تسوقك معنا!\n\n📦 رقم الطلب: ${orderNumber}\n🛍️ المنتجات:\n${lines}\n\n💰 الإجمالي: ${total} ريال\n💳 طريقة الدفع: ${paymentMethod}\n\nنأمل أن تنال المنتجات رضاك.\nشكرًا لاختيارك عود الزباره 🌿`;
    const en = `✅ Order Receipt – Oud Al Zubarah ✅\n\nHello ${name},\nThank you for your purchase!\n\n📦 Order #${orderNumber}\n🛍️ Items:\n${lines}\n\n💰 Total: ${total} QAR\n💳 Payment Method: ${paymentMethod}\n\nWe hope you enjoy your order.\nThank you for choosing Oud Al Zubarah 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendPromotion(phone: string, name: string, message: string): Promise<boolean> {
    const ar = `🎉 *عرض خاص!*\n\nمرحبًا ${name}،\n${message}\n\nعود الزباره 🌿`;
    const en = `🎉 Special Offer!\n\nHello ${name},\n${message}\n\nOud Al Zubarah 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendLoyaltyUpdate(phone: string, name: string, points: number, tier: string): Promise<boolean> {
    const ar = `🏆 *تحديث الولاء*\n\nمرحبًا ${name}،\nلديك الآن *${points} نقطة*!\nالمستوى: *${tier}*\n\nتابع التسوق للحصول على المزيد من المكافآت! 🌿`;
    const en = `🏆 Loyalty Update\n\nHello ${name},\nYou now have *${points} points*!\nTier: *${tier}*\n\nKeep shopping to earn more rewards! 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendCustomerOrderDeliveredNotification(phone: string, customerName: string, orderNumber: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    const ar = `✅ تم تسليم طلبك بنجاح ✅\n\nمرحبًا ${customerName},\nتم تسليم طلبك *#${orderNumber}* بنجاح\n\nنأمل أن تنال منتجات عود الزباره رضاك. شكرًا لك! 🌿`;
    const en = `✅ Order Delivered Successfully ✅\n\nHello ${customerName},\nYour Order #${orderNumber} has been delivered successfully\n\nWe hope you enjoy your purchase. Thank you! 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendAutomaticReviewRequest(phone: string, customerName: string, orderNumber: string, reviewLink: string, lang?: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const L = lang || (runtime as any).language || 'en';
    
    const ar = `⭐ نود معرفة رأيك ⭐\n\nمرحبًا ${customerName},\nشكرًا لك على شرائك من عود الزباره!\n\nيرجى تقييم تجربتك لطلبك *#${orderNumber}*:\n${reviewLink}\n\nآراؤك تساعدنا في تحسين خدماتنا 🌿`;
    const en = `⭐ We'd love your feedback ⭐\n\nHello ${customerName},\nThank you for purchasing from Oud Al Zubarah!\n\nPlease leave a review for your order #${orderNumber}:\n${reviewLink}\n\nYour feedback helps us improve our service 🌿`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }

  async sendInventorySummary(phone: string, items: Array<{ name: string; stock: number }>, lang?: string): Promise<boolean> {
    const lines = (items || []).slice(0, 50).map((it) => `• ${it.name}: ${it.stock}`).join('\n') || 'لا توجد عناصر منخفضة المخزون';
    const ar = `تقرير المخزون\n\nالعناصر ذات المخزون المنخفض:\n${lines}\n\nالرجاء إعادة التوريد عند الحاجة.`;
    const en = `Inventory Report\n\nLow stock items:\n${lines}\n\nPlease restock as needed.`;
    return this.sendMessage(phone, `${ar}\n\n${en}`);
  }
}
