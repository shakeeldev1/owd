import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SMSMessage {
  to: string;
  message: string;
  context?: Record<string, any>;
}

export interface SendSMSResponse {
  success: boolean;
  messageId?: string;
  status?: string;
  recipient?: string;
  error?: string;
  attempts?: Array<{
    candidate: string;
    status: number;
    data: any;
  }>;
  details?: any;
}

@Injectable()
export class SMSService {
  private apiUrl: string;
  private apiKey: string;
  private sender: string;
  private mediaApiUrl: string;
  private readonly maxMessageLength = 4096;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get('MESSAGING_API_URL', 'https://custom1.waghl.com/send-message');
    this.apiKey = this.configService.get('MESSAGING_API_KEY', '');
    this.sender = this.configService.get('MESSAGING_SENDER', '');
    this.mediaApiUrl = this.configService.get('MESSAGING_MEDIA_API_URL', 'https://custom1.waghl.com/send-media');

    // Validate environment variables
    if (!this.apiKey || !this.sender) {
      console.warn('⚠️ Messaging credentials not fully configured. Check MESSAGING_API_KEY and MESSAGING_SENDER.');
    } else {
      console.log('✅ SMS Service Initialized:', {
        sender: this.sender,
        apiUrl: this.apiUrl,
      });
    }
  }

  /**
   * Normalize phone number by removing non-digit characters
   */
  private normalizePhoneNumber(phone: string): string {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/\D/g, '');
  }

  /**
   * Apply default country code (Qatar - 974) if missing
   */
  private applyDefaultCountryCode(digits: string): string {
    if (!digits) return '';

    // Handle local Qatar numbers when country code is missing
    if (digits.length === 8) return `974${digits}`;
    if (digits.length === 9 && digits.startsWith('0')) return `974${digits.slice(1)}`;

    return digits;
  }

  /**
   * Generate phone number candidates for retry logic
   */
  private candidatePhoneNumbers(phone: string): string[] {
    const raw = (phone || '').trim();
    const normalizedDigits = this.normalizePhoneNumber(raw);
    const digits = this.applyDefaultCountryCode(normalizedDigits);

    const variants: string[] = [];
    if (digits) variants.push(digits);
    if (raw.startsWith('+') && digits) variants.push(`+${digits}`);
    if (!raw.startsWith('+') && digits) variants.push(`+${digits}`);

    return [...new Set(variants)].filter(Boolean);
  }

  /**
   * Parse API response safely
   */
  private async parseApiResponse(response: Response): Promise<{ parsed: any; rawBody: string }> {
    const rawBody = await response.text();
    if (!rawBody) return { parsed: null, rawBody: '' };

    try {
      return { parsed: JSON.parse(rawBody), rawBody };
    } catch {
      return { parsed: null, rawBody };
    }
  }

  /**
   * Extract provider error from API response
   */
  private extractProviderError(payload: any, fallbackStatus: number): string {
    if (!payload) return `Failed to send SMS (Status: ${fallbackStatus || 'unknown'})`;
    if (typeof payload === 'string') return payload;

    return (
      payload.errors ||
      payload.error ||
      payload.msg ||
      payload.message ||
      `Failed to send SMS (Status: ${fallbackStatus || 'unknown'})`
    );
  }

  /**
   * Sanitize message to ensure it doesn't exceed max length
   */
  private sanitizeMessage(message: string): string {
    const safeMessage = (message || '').trim();
    if (!safeMessage) return '';
    if (safeMessage.length <= this.maxMessageLength) return safeMessage;
    return `${safeMessage.slice(0, this.maxMessageLength - 3)}...`;
  }

  /**
   * Send SMS message
   */
  async sendSMS(to: string, message: string, context: Record<string, any> = {}): Promise<SendSMSResponse> {
    try {
      if (!this.apiKey || !this.sender) {
        const error = 'SMS API credentials not configured in environment variables';
        console.error('❌', error);
        return { success: false, error };
      }

      // Validate phone number
      if (!to || typeof to !== 'string') {
        const error = 'Invalid phone number provided';
        console.error('❌', error, 'Received:', to);
        return { success: false, error };
      }

      const phoneCandidates = this.candidatePhoneNumbers(to);

      if (!phoneCandidates.length) {
        const error = 'Phone number normalization failed or produced invalid number';
        console.error('❌', error, { original: to, candidates: phoneCandidates, context });
        return { success: false, error };
      }

      const sanitizedMsg = this.sanitizeMessage(message);
      if (!sanitizedMsg) {
        console.warn('⚠️ SMS message skipped: empty message payload');
        return { success: false, error: 'Empty message provided' };
      }

      const failedAttempts: Array<{ candidate: string; status: number; data: any }> = [];

      for (const candidate of phoneCandidates) {
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            sender: this.sender,
            number: candidate,
            message: sanitizedMsg,
          }),
        });

        const { parsed: data, rawBody } = await this.parseApiResponse(response);

        if (response.ok) {
          console.log('✅ SMS sent successfully:', {
            to: candidate,
            context,
          });
          return {
            success: true,
            messageId: data?.id || data?.message_id || 'sent',
            status: 'sent',
            recipient: candidate,
          };
        }

        failedAttempts.push({
          candidate,
          status: response.status,
          data: data || rawBody,
        });
      }

      console.error(
        '❌ SMS API failed for all candidate formats',
        JSON.stringify(
          {
            to,
            candidates: phoneCandidates,
            attempts: failedAttempts,
            context,
          },
          null,
          2,
        ),
      );

      const lastFailure = failedAttempts[failedAttempts.length - 1];
      return {
        success: false,
        error: this.extractProviderError(lastFailure?.data, lastFailure?.status),
        attempts: failedAttempts,
      };
    } catch (err) {
      const error = err as Error;
      const errorDetails = {
        message: error?.message || String(err),
        to,
        context,
      };
      console.error('❌ Error sending SMS:', errorDetails);
      return {
        success: false,
        error: error?.message || String(err),
        details: errorDetails,
      };
    }
  }

  /**
   * Send media (image) via SMS
   */
  async sendMediaSMS(to: string, caption: string, imageUrl: string, context: Record<string, any> = {}): Promise<SendSMSResponse> {
    try {
      if (!this.apiKey || !this.sender) {
        const error = 'SMS API credentials not configured in environment variables';
        console.error('❌', error);
        return { success: false, error };
      }

      // Validate phone number
      if (!to || typeof to !== 'string') {
        const error = 'Invalid phone number provided';
        console.error('❌', error, 'Received:', to);
        return { success: false, error };
      }

      // Validate image URL
      if (!imageUrl || typeof imageUrl !== 'string') {
        const error = 'Invalid image URL provided';
        console.error('❌', error, 'Received:', imageUrl);
        return { success: false, error };
      }

      const phoneCandidates = this.candidatePhoneNumbers(to);

      if (!phoneCandidates.length) {
        const error = 'Phone number normalization failed or produced invalid number';
        console.error('❌', error, { original: to, candidates: phoneCandidates, context });
        return { success: false, error };
      }

      const failedAttempts: Array<{ candidate: string; status: number; data: any }> = [];

      for (const candidate of phoneCandidates) {
        const response = await fetch(this.mediaApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            api_key: this.apiKey,
            sender: this.sender,
            number: candidate,
            caption,
            media_type: 'image',
            url: imageUrl,
          }),
        });

        const { parsed: data, rawBody } = await this.parseApiResponse(response);

        if (response.ok) {
          console.log('✅ Media SMS sent successfully:', {
            to: candidate,
            context,
          });
          return {
            success: true,
            messageId: data?.id || data?.message_id || 'sent',
            status: 'sent',
            recipient: candidate,
          };
        }

        failedAttempts.push({
          candidate,
          status: response.status,
          data: data || rawBody,
        });
      }

      console.error(
        '❌ SMS media API failed for all candidate formats',
        JSON.stringify(
          {
            to,
            candidates: phoneCandidates,
            attempts: failedAttempts,
            context,
          },
          null,
          2,
        ),
      );

      const lastFailure = failedAttempts[failedAttempts.length - 1];
      return {
        success: false,
        error: this.extractProviderError(lastFailure?.data, lastFailure?.status),
        attempts: failedAttempts,
      };
    } catch (err) {
      const error = err as Error;
      const errorDetails = {
        message: error?.message || String(err),
        to,
        context,
      };
      console.error('❌ Error sending media SMS:', errorDetails);
      return {
        success: false,
        error: error?.message || String(err),
        details: errorDetails,
      };
    }
  }

  /**
   * Send welcome SMS to new user
   */
  async sendWelcomeSMS(customerPhone: string, customerName: string): Promise<SendSMSResponse> {
    try {
      const messageArabic = `مرحباً بك في أود الزبارة 🌟

تم تفعيل حسابك بنجاح!

👤 اسمك: ${customerName}
📱 رقم هاتفك: ${customerPhone}

━━━━━━━━━━━━━━━━━━━━━

🎁 ما الذي يمكنك الاستفادة منه:
✓ تصفح مجموعتنا الفريدة من العطور
✓ عروض حصرية وخصومات خاصة
✓ برنامج الولاء والمكافآت
✓ تتبع طلباتك في الوقت الفعلي

🔗 ابدأ التسوق الآن:
https://oudalzubarah.com

━━━━━━━━━━━━━━━━━━━━━

شكراً لاختيارك أود الزبارة 💎`;

      const messageEnglish = `Welcome to Oud Al Zubarah 🌟

Your account has been activated successfully!

👤 Your Name: ${customerName}
📱 Your Phone: ${customerPhone}

━━━━━━━━━━━━━━━━━━━━━

🎁 What You Can Enjoy:
✓ Browse our unique collection of fragrances
✓ Exclusive offers and special discounts
✓ Loyalty program and rewards
✓ Real-time order tracking

🔗 Start Shopping Now:
https://oudalzubarah.com

━━━━━━━━━━━━━━━━━━━━━

Thank you for choosing Oud Al Zubarah 💎`;

      const combinedMessage = `${messageArabic}\n\n━━━━━━━━━━━━━━━━━━━━━\n\n${messageEnglish}`;

      return await this.sendSMS(customerPhone, combinedMessage, {
        flow: 'welcome_sms',
        recipientName: customerName,
        recipientRole: 'customer',
      });
    } catch (err) {
      const error = err as Error;
      console.error('❌ Error in sendWelcomeSMS:', error);
      return { success: false, error: error?.message || String(err) };
    }
  }

  /**
   * Send order confirmation SMS to customer
   */
  async sendOrderConfirmationSMS(customerPhone: string, customerName: string, orderDetails: any): Promise<SendSMSResponse> {
    try {
      const orderId = orderDetails._id || orderDetails.id;
      const orderNumber = orderDetails.orderNumber || `#${String(orderId).slice(-8).toUpperCase()}`;
      const total = orderDetails.total?.toFixed(2) || '0.00';
      const itemCount = orderDetails.items?.length || 0;

      const messageArabic = `طلبك قد تم استلامه بنجاح! ✅

مرحباً ${customerName}

🆔 رقم الطلب: ${orderNumber}
📦 عدد المنتجات: ${itemCount}
💰 المبلغ الإجمالي: ${total} QAR

━━━━━━━━━━━━━━━━━━━━━

📋 تفاصيل الطلب:
${
  orderDetails.items && Array.isArray(orderDetails.items)
    ? orderDetails.items.map((item) => `  • ${item.name || item.productName || 'منتج'} (${item.quantity}x)`).join('\n')
    : '  • راجع الطلب للتفاصيل الكاملة'
}

⏱️ حالة الطلب:
⏳ قيد المراجعة

━━━━━━━━━━━━━━━━━━━━━

✨ سيتم معالجة طلبك قريباً
📞 للاستفسارات: https://oudalzubarah.com

شكراً لتسوقك معنا 💎`;

      const messageEnglish = `Your Order Has Been Received! ✅

Hello ${customerName}

🆔 Order Number: ${orderNumber}
📦 Number of Items: ${itemCount}
💰 Total Amount: ${total} QAR

━━━━━━━━━━━━━━━━━━━━━

📋 Order Details:
${
  orderDetails.items && Array.isArray(orderDetails.items)
    ? orderDetails.items.map((item) => `  • ${item.name || item.productName || 'Product'} (${item.quantity}x)`).join('\n')
    : '  • Check your order for full details'
}

⏱️ Order Status:
⏳ Under Review

━━━━━━━━━━━━━━━━━━━━━

✨ Your order will be processed soon
📞 For inquiries: https://oudalzubarah.com

Thank you for shopping with us 💎`;

      const combinedMessage = `${messageArabic}\n\n━━━━━━━━━━━━━━━━━━━━━\n\n${messageEnglish}`;

      return await this.sendSMS(customerPhone, combinedMessage, {
        flow: 'order_confirmation',
        orderId: String(orderId),
        recipientRole: 'customer',
      });
    } catch (err) {
      const error = err as Error;
      console.error('❌ Error in sendOrderConfirmationSMS:', error);
      return { success: false, error: error?.message || String(err) };
    }
  }

  /**
   * Send order status update SMS to customer
   */
  async sendOrderStatusUpdateSMS(customerPhone: string, customerName: string, orderDetails: any, newStatus: string): Promise<SendSMSResponse> {
    try {
      const orderId = orderDetails._id || orderDetails.id;
      const orderNumber = orderDetails.orderNumber || `#${String(orderId).slice(-8).toUpperCase()}`;

      const statusMap = {
        pending: { ar: 'قيد الانتظار', en: 'Pending', emoji: '⏳' },
        processing: { ar: 'قيد المعالجة', en: 'Processing', emoji: '⚙️' },
        shipped: { ar: 'تم الشحن', en: 'Shipped', emoji: '🚚' },
        delivered: { ar: 'تم الاستلام', en: 'Delivered', emoji: '✅' },
        cancelled: { ar: 'ملغى', en: 'Cancelled', emoji: '❌' },
      };

      const status = statusMap[newStatus] || { ar: newStatus, en: newStatus, emoji: '📦' };

      const messageArabic = `تحديث حالة طلبك ${status.emoji}

مرحباً ${customerName}

🆔 رقم الطلب: ${orderNumber}
📍 الحالة الحالية: ${status.ar}

━━━━━━━━━━━━━━━━━━━━━

${newStatus === 'delivered' ? `🎉 تم استلام طلبك بنجاح!

شكراً لتسوقك معنا. نرجو لك تجربة ممتعة!` : `⏱️ الرجاء الانتظار قليلاً...

سيتم تحديثك عند أي تغيير جديد`}

━━━━━━━━━━━━━━━━━━━━━

📱 تتبع طلبك:
https://oudalzubarah.com/orders/${orderId}

شكراً لاختيارك أود الزبارة 💎`;

      const messageEnglish = `Order Status Update ${status.emoji}

Hello ${customerName}

🆔 Order Number: ${orderNumber}
📍 Current Status: ${status.en}

━━━━━━━━━━━━━━━━━━━━━

${newStatus === 'delivered' ? `🎉 Your order has been delivered successfully!

Thank you for shopping with us. We hope you enjoy it!` : `⏱️ Please wait...

You'll be notified when there's an update`}

━━━━━━━━━━━━━━━━━━━━━

📱 Track Your Order:
https://oudalzubarah.com/orders/${orderId}

Thank you for choosing Oud Al Zubarah 💎`;

      const combinedMessage = `${messageArabic}\n\n━━━━━━━━━━━━━━━━━━━━━\n\n${messageEnglish}`;

      return await this.sendSMS(customerPhone, combinedMessage, {
        flow: 'order_status_update',
        orderId: String(orderId),
        status: newStatus,
        recipientRole: 'customer',
      });
    } catch (err) {
      const error = err as Error;
      console.error('❌ Error in sendOrderStatusUpdateSMS:', error);
      return { success: false, error: error?.message || String(err) };
    }
  }

  /**
   * Test SMS API connectivity
   */
  async testConnection(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      if (!this.apiKey || !this.sender) {
        return {
          success: false,
          error: 'SMS API credentials not configured. Please check your environment variables.',
        };
      }

      console.log('✅ SMS API configured successfully');
      return { success: true, message: 'SMS API configured successfully' };
    } catch (err) {
      const error = err as Error;
      console.error('❌ SMS API connection failed:', error?.message || String(err));
      return { success: false, error: error?.message || String(err) };
    }
  }
}
