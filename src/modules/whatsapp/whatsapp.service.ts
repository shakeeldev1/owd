import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppMessage {
  to: string;
  template?: string;
  text?: string;
  params?: Record<string, string>;
}

@Injectable()
export class WhatsAppService {
  private apiUrl: string;
  private phoneNumberId: string;
  private accessToken: string;
  private enabled: boolean;

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get('WHATSAPP_API_URL', '');
    this.phoneNumberId = this.configService.get('WHATSAPP_PHONE_NUMBER_ID', '');
    this.accessToken = this.configService.get('WHATSAPP_ACCESS_TOKEN', '');
    this.enabled = !!(this.phoneNumberId && this.accessToken && this.phoneNumberId !== 'YOUR_PHONE_NUMBER_ID');
  }

  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/[\s\-\(\)]/g, '');
    if (!cleaned.startsWith('+')) cleaned = '+974' + cleaned;
    return cleaned.replace('+', '');
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.enabled) {
      console.log(`📱 [WhatsApp Disabled] To: ${phone} | Message: ${message}`);
      return true;
    }

    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.formatPhone(phone),
          type: 'text',
          text: { body: message },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('❌ WhatsApp send failed:', error);
        return false;
      }

      console.log(`✅ WhatsApp sent to ${phone}`);
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
