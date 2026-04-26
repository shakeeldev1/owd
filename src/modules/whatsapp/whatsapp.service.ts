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
    const configuredApiUrl = this.configService.get('MESSAGING_API_URL', 'https://custom1.waghl.com/');
    this.apiUrl = this.normalizeApiUrl(configuredApiUrl);
    this.apiKey = this.configService.get('MESSAGING_API_KEY', '');
    this.sender = this.normalizeDigits(this.configService.get('MESSAGING_SENDER', ''));
    this.defaultNumber = this.normalizeDigits(this.configService.get('MESSAGING_DEFAULT_NUMBER', '923207521951'));
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
    const envSender = this.normalizeDigits(this.sender);
    const runtimeSender = this.normalizeDigits(runtime?.whatsappNumber || '');
    // Provider validates sender against the currently connected sender account.
    // Prefer runtime sender from settings, then env/default fallback.
    return runtimeSender || envSender || this.defaultNumber;
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
        apiKey: this.apiKey,
        sender: this.normalizeDigits(sender),
        number,
        message,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async sendMessage(phone: string, message: string, options?: { mirrorToAdmin?: boolean }): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const mirrorToAdmin = options?.mirrorToAdmin !== false;

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
    const msg = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n\n💰 الإجمالي: ${total} ريال قطري\n\nسيتم إشعارك بجميع التحديثات.`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderProcessing(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const msg = `طلبك الآن قيد التجهيز ✨\nنعمل على تحضيره بأعلى جودة.\n\nسيتم إشعارك عند خروجه للتوصيل.`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderShipped(phone: string, name: string, orderNumber: string, trackingNumber?: string, driverPhone?: string, location?: string): Promise<boolean> {
    let msg = `🚚 طلبك في الطريق إليك الآن\n\n`;
    if (driverPhone) msg += `📞 رقم المندوب: ${driverPhone}\n`;
    if (location) msg += `📍 الموقع: ${location}\n`;
    msg += `\nشكرًا لاختيارك عود الزباره 🌿`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderDelivered(phone: string, name: string, orderNumber: string): Promise<boolean> {
    const msg = `تم تسليم طلبك بنجاح 🌿\n\nنتمنى أن تنال منتجات عود الزباره إعجابك 🤍`;
    return this.sendMessage(phone, msg);
  }

  async sendOrderCancelled(phone: string, name: string, orderNumber: string): Promise<boolean> {
    return this.sendMessage(phone,
      `❌ *تم إلغاء الطلب*\n\nمرحبًا ${name}،\nتم إلغاء طلبك *#${orderNumber}*.\n\nإذا كانت لديك أي استفسارات، يرجى التواصل معنا.\n\nعود الزباره 🌿`
    );
  }

  // Staff notifications
  async sendNewOrderAlert(phone: string, orderNumber: string, total: number): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const arMsg = `🔔 طلب جديد\n\nرقم الطلب: *#${orderNumber}*\nالإجمالي: *${total} ريال قطري*\n\nيرجى التحقق من لوحة التحكم.`;
    const message = arMsg;

    // If caller requests 'admin', notify the configured admin number(s) + any additional recipients
    if (phone && String(phone).toLowerCase() === 'admin') {
      const recipients = new Set<string>();

      // Admin recipients from env var (comma/newline/semicolon separated)
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

      // Fallback to runtime/default admin number only when env list is empty.
      if (recipients.size === 0) {
        const primaryAdmin = runtime.whatsappNumber || this.defaultNumber;
        if (primaryAdmin) {
          const formatted = this.formatPhone(primaryAdmin, this.defaultNumber);
          if (formatted && this.isValidPhone(formatted)) recipients.add(formatted);
        }
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
            return false;
          }
        }),
      );

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
    
    if (lang === 'ar') {
      const msg = `📢 تحديث حالة الطلب\n\nرقم الطلب: *#${orderNumber}*\nالعميل: ${customerName || 'غير محدد'}\nرقم الهاتف: ${customerPhone || 'غير محدد'}\nالحالة الجديدة: *${status}*\nالوقت: ${timestamp}`;
      return this.sendMessage(phone, msg);
    }
    
    return this.sendMessage(
      phone,
      `📢 تحديث حالة الطلب\n\nرقم الطلب: *#${orderNumber}*\nالعميل: ${customerName || 'غير محدد'}\nرقم الهاتف: ${customerPhone || 'غير محدد'}\nالحالة الجديدة: *${status}*\nالوقت: ${timestamp}`,
    );
  }

  async sendDeliveryAssignment(phone: string, staffName: string, orderNumber: string, address: string): Promise<boolean> {
    const runtime = await this.getRuntimeSettings();
    const lang = (runtime as any).language || 'en';
    
    if (lang === 'ar') {
      const msg = `📋 تم تعيينك لتوصيل جديد\n\nمرحبًا ${staffName},\nتم تعيينك لتوصيل الطلب *#${orderNumber}*.\nالعنوان: ${address}\n\nيرجى تحديث الحالة عند الانتهاء.`;
      return this.sendMessage(phone, msg);
    }
    
    return this.sendMessage(phone,
      `📋 تم تعيينك لتوصيل جديد\n\nمرحبًا ${staffName},\nتم تعيينك لتوصيل الطلب *#${orderNumber}*\.\nالعنوان: ${address}\n\nيرجى تحديث الحالة عند الانتهاء.`
    );
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
    
    if (lang === 'ar') {
      const msg = `🚚 نحن في الطريق إليك\n\nمرحبًا ${customerName},\nتم تعيين المندوب لتوصيل طلبك *#${orderNumber}*.\nاسم المندوب: ${staffName}\nرقم الهاتف: ${staffPhone || 'يرجى التواصل مع خدمة العملاء'}\n\nشكرًا لاختيارك عود الزباره 🌿`;
      return this.sendMessage(phone, msg);
    }
    
    return this.sendMessage(
      phone,
      `🚚 نحن في الطريق إليك\n\nمرحبًا ${customerName},\nتم تعيين المندوب لتوصيل طلبك *#${orderNumber}*\.\nاسم المندوب: ${staffName}\nرقم الهاتف: ${staffPhone || 'يرجى التواصل مع خدمة العملاء'}\n\nشكرًا لاختيارك عود الزباره 🌿`,
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

      const msg = `🚫 نفاد المخزون\n\nالمنتج: ${productName}\n\nالكمية الحالية: 0\n\nيرجى إعادة التوريد فورًا.`;
      return this.sendMessage(phone, msg);
    }

    // Low stock (threshold example: <=10)
    if (currentStock <= 10) {
      if (lang === 'ar') {
        const msg = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}\n\nيرجى إعادة التوريد قريبًا.`;
        return this.sendMessage(phone, msg);
      }

      const msg = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}\n\nيرجى إعادة التوريد قريبًا.`;
      return this.sendMessage(phone, msg);
    }

    // Fallback: still send a gentle low-stock notice in default language
    if (lang === 'ar') {
      const msg = `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}`;
      return this.sendMessage(phone, msg);
    }
    return this.sendMessage(phone, `⚠️ تنبيه مخزون منخفض\n\nالمنتج: ${productName}\nالكمية المتبقية: ${currentStock}`);
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

    if (L === 'ar') {
      let msg = `كيف كانت تجربتك مع عود الزباره؟ 🌿\n\nرأيك يهمنا كثيرًا\n\n⭐⭐⭐⭐⭐\n\n`;
      if (appReviewLink) {
        msg += `📱 شارك تقييمك في التطبيق:\n${appReviewLink}\n\n`;
      }
      msg += `🌐 أو شارك تقييمك من هنا:\n${googleReviewLink}\n\n🎁 ستحصل على عرض خاص بعد التقييم`;
      return this.sendMessage(phone, msg);
    }

    let msg = `كيف كانت تجربتك مع عود الزباره؟ 🌿\n\nرأيك يهمنا كثيرًا\n\n⭐⭐⭐⭐⭐\n\n`;
    if (appReviewLink) {
      msg += `📱 شارك تقييمك في التطبيق:\n${appReviewLink}\n\n`;
    }
    msg += `🌐 أو شارك تقييمك من هنا:\n${googleReviewLink}\n\n🎁 ستحصل على عرض خاص بعد التقييم`;
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

    const msg = `🧾 فاتورة طلبك – عود الزباره\n\nشكرًا لطلبك 🌿\nتم استلام طلبك بنجاح.\n\n📦 رقم الطلب: ${orderNumber}\n🛍️ المنتجات:\n${lines}\n\n💰 الإجمالي: ${total} ريال قطري\n💳 طريقة الدفع: ${paymentMethod}\n\nسيتم إشعارك بجميع التحديثات.`;
    return this.sendMessage(phone, msg);
  }

  async sendPromotion(phone: string, name: string, message: string): Promise<boolean> {
    return this.sendMessage(phone,
      `🎉 *عرض خاص!*\n\nمرحبًا ${name}،\n${message}\n\nعود الزباره 🌿`
    );
  }

  async sendLoyaltyUpdate(phone: string, name: string, points: number, tier: string): Promise<boolean> {
    return this.sendMessage(phone,
      `🏆 *تحديث الولاء*\n\nمرحبًا ${name}،\nلديك الآن *${points} نقطة*!\nالمستوى: *${tier}*\n\nتابع التسوق للحصول على المزيد من المكافآت! 🌿`
    );
  }

  async sendInventorySummary(phone: string, items: Array<{ name: string; stock: number }>, lang?: string): Promise<boolean> {
    const lines = (items || []).slice(0, 50).map((it) => `• ${it.name}: ${it.stock}`).join('\n') || 'لا توجد عناصر منخفضة المخزون';
    const msg = `تقرير المخزون\n\nالعناصر ذات المخزون المنخفض:\n${lines}\n\nالرجاء إعادة التوريد عند الحاجة.`;
    return this.sendMessage(phone, msg);
  }
}
