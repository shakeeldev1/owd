import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.configService.get('SMTP_USER'),
        pass: this.configService.get('SMTP_PASS'),
      },
      secure: true,
      timeout: 10000,
    } as any);
  }

  private get brandName(): string {
    return 'Oud Al Zubarah';
  }

  async sendMail(to: string, subject: string, html: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: `"${this.brandName}" <${this.configService.get('SMTP_USER')}>`,
        to,
        subject,
        html,
      });
    } catch (error: any) {
      console.error('❌ Email sending failed:', error?.message || error);
    }
  }

  async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Premium Oud & Fragrances</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Hello ${name},</h2>
          <p style="color:#64748b;line-height:1.6;">Your verification code is:</p>
          <div style="background:#f8fafc;border:2px dashed #BA974F;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${otp}</span>
          </div>
          <p style="color:#64748b;line-height:1.6;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px;">If you didn't request this, please ignore this email.</p>
        </div>
      </div>
    `;
    await this.sendMail(to, `Verify Your Account - ${this.brandName}`, html);
  }

  async sendPasswordResetEmail(to: string, otp: string, name: string): Promise<void> {
    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Password Reset</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Hello ${name},</h2>
          <p style="color:#64748b;line-height:1.6;">We received a request to reset your password. Use the code below:</p>
          <div style="background:#f8fafc;border:2px dashed #BA974F;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${otp}</span>
          </div>
          <p style="color:#64748b;line-height:1.6;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px;">If you didn't request a password reset, please ignore this email. Your password will not be changed.</p>
        </div>
      </div>
    `;
    await this.sendMail(to, `Reset Your Password - ${this.brandName}`, html);
  }

  async sendOrderConfirmation(to: string, name: string, orderNumber: string, total: number, items: any[]): Promise<void> {
    const itemsHtml = items.map(item => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.price} QAR</td>
      </tr>
    `).join('');

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Order Confirmation</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Thank you, ${name}!</h2>
          <p style="color:#64748b;line-height:1.6;">Your order <strong>#${orderNumber}</strong> has been placed successfully.</p>
          <table style="width:100%;border-collapse:collapse;margin:24px 0;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:8px;text-align:left;color:#1a1a2e;">Item</th>
                <th style="padding:8px;text-align:center;color:#1a1a2e;">Qty</th>
                <th style="padding:8px;text-align:right;color:#1a1a2e;">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:right;">
            <strong style="font-size:18px;color:#1a1a2e;">Total: ${total} QAR</strong>
          </div>
          <p style="color:#64748b;line-height:1.6;margin-top:24px;">We'll notify you when your order status changes.</p>
        </div>
      </div>
    `;
    await this.sendMail(to, `Order Confirmed #${orderNumber} - ${this.brandName}`, html);
  }

  async sendPaymentReceipt(
    to: string,
    name: string,
    orderNumber: string,
    total: number,
    paymentMethod: string,
    items: any[],
  ): Promise<void> {
    const itemsHtml = items.map(item => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.price} QAR</td>
      </tr>
    `).join('');

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Digital Receipt</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Thank you, ${name}!</h2>
          <p style="color:#64748b;line-height:1.6;">Payment received for order <strong>#${orderNumber}</strong>.</p>
          <p style="color:#64748b;line-height:1.6;"><strong>Payment Method:</strong> ${paymentMethod}</p>
          <table style="width:100%;border-collapse:collapse;margin:24px 0;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="padding:8px;text-align:left;color:#1a1a2e;">Product</th>
                <th style="padding:8px;text-align:center;color:#1a1a2e;">Quantity</th>
                <th style="padding:8px;text-align:right;color:#1a1a2e;">Price</th>
              </tr>
            </thead>
            <tbody>${itemsHtml}</tbody>
          </table>
          <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:right;">
            <strong style="font-size:18px;color:#1a1a2e;">Total Paid: ${total} QAR</strong>
          </div>
        </div>
      </div>
    `;

    await this.sendMail(to, `Receipt #${orderNumber} - ${this.brandName}`, html);
  }

  async sendOrderStatusUpdate(to: string, name: string, orderNumber: string, status: string): Promise<void> {
    const statusMessages: Record<string, string> = {
      processing: 'Your order is being prepared.',
      shipped: 'Your order has been shipped and is on its way!',
      delivered: 'Your order has been delivered. Enjoy!',
      cancelled: 'Your order has been cancelled.',
    };

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Order Update</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Hello ${name},</h2>
          <p style="color:#64748b;line-height:1.6;">Order <strong>#${orderNumber}</strong> status update:</p>
          <div style="background:#f8fafc;border-left:4px solid #BA974F;padding:16px;margin:24px 0;border-radius:0 8px 8px 0;">
            <strong style="color:#1a1a2e;text-transform:capitalize;">${status}</strong>
            <p style="color:#64748b;margin:8px 0 0;">${statusMessages[status] || 'Your order status has been updated.'}</p>
          </div>
        </div>
      </div>
    `;
    await this.sendMail(to, `Order #${orderNumber} - ${status.charAt(0).toUpperCase() + status.slice(1)} - ${this.brandName}`, html);
  }

  async sendFeedbackRequest(
    to: string,
    name: string,
    orderNumber: string,
    googleReviewLink: string,
    orderId?: string,
  ): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', 'https://oudalzubarah.com');
    const appReviewLink = orderId ? `${frontendUrl}/orders/${orderId}/review` : null;

    const reviewButtonsHtml = appReviewLink
      ? `
        <div style="margin:24px 0;">
          <p style="color:#64748b;line-height:1.6;margin-bottom:16px;text-align:center;">Choose where to leave your review:</p>
          <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
            <a href="${appReviewLink}" style="background:#BA974F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Review in App 📱</a>
            <a href="${googleReviewLink}" style="background:#4285f4;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Google Review 🌐</a>
          </div>
        </div>
      `
      : `
        <div style="text-align:center;margin:32px 0;">
          <a href="${googleReviewLink}" style="background:#BA974F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Leave a Review ⭐</a>
        </div>
      `;

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">We Value Your Feedback</p>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1a1a2e;margin:0 0 16px;">Hello ${name},</h2>
          <p style="color:#64748b;line-height:1.6;">Thank you for your order <strong>#${orderNumber}</strong>!</p>
          <p style="color:#64748b;line-height:1.6;">We'd love to hear about your experience.</p>
          ${reviewButtonsHtml}
          <p style="color:#94a3b8;font-size:12px;text-align:center;">Your feedback helps us serve you better!</p>
        </div>
      </div>
    `;
    await this.sendMail(to, `How was your order? - ${this.brandName}`, html);
  }

  async sendLowStockAlert(productName: string, currentStock: number, unit: string): Promise<void> {
    const adminEmail = this.configService.get('ADMIN_EMAIL') || this.configService.get('SMTP_USER');
    if (!adminEmail) return;

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Low Stock Alert</p>
        </div>
        <div style="padding:32px;">
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:0 0 24px;border-radius:0 8px 8px 0;">
            <h2 style="color:#92400e;margin:0 0 8px;">⚠️ Low Stock Warning</h2>
            <p style="color:#78350f;margin:0;font-size:16px;">
              Product <strong>${productName}</strong> is almost out of stock.<br/>
              Remaining quantity: <strong>${currentStock} ${unit.toLowerCase()}</strong>.
            </p>
          </div>
          <p style="color:#64748b;line-height:1.6;">Please restock this item as soon as possible to avoid stockouts.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${this.configService.get('FRONTEND_URL', 'http://localhost:3000')}/admin/inventory" style="background:#BA974F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">View Inventory</a>
          </div>
        </div>
      </div>
    `;
    await this.sendMail(adminEmail, `⚠️ Low Stock: ${productName} - ${this.brandName}`, html);
  }

  async sendLowStockBulkAlert(items: string[]): Promise<void> {
    const adminEmail = this.configService.get('ADMIN_EMAIL') || this.configService.get('SMTP_USER');
    if (!adminEmail) return;

    const itemsHtml = items.map(item => `<li style="padding:4px 0;color:#78350f;">${item}</li>`).join('');

    const html = `
      <div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:32px;text-align:center;">
          <h1 style="color:#BA974F;margin:0;font-size:24px;">${this.brandName}</h1>
          <p style="color:#94a3b8;margin:8px 0 0;">Low Stock Report</p>
        </div>
        <div style="padding:32px;">
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:0 0 24px;border-radius:0 8px 8px 0;">
            <h2 style="color:#92400e;margin:0 0 12px;">⚠️ ${items.length} Products Below Stock Threshold</h2>
            <ul style="margin:0;padding-left:20px;">${itemsHtml}</ul>
          </div>
          <p style="color:#64748b;line-height:1.6;">Please review and restock these items.</p>
          <div style="text-align:center;margin:24px 0;">
            <a href="${this.configService.get('FRONTEND_URL', 'http://localhost:3000')}/admin/inventory" style="background:#BA974F;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">View Inventory</a>
          </div>
        </div>
      </div>
    `;
    await this.sendMail(adminEmail, `⚠️ Low Stock Alert: ${items.length} items - ${this.brandName}`, html);
  }
}
