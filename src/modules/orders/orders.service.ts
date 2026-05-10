import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import CryptoJS from 'crypto-js';
import * as bcrypt from 'bcryptjs';
import { Order, OrderDocument } from './schemas/order.schema';
import { Review, ReviewDocument } from './schemas/review.schema';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';
import {
  CreateOrderDto,
  AdminCreateOrderDto,
  UpdateOrderStatusDto,
  AssignDeliveryDto,
  SubmitFeedbackDto,
  UpdateOrderPaymentDto,
  CreateSkipCashSessionDto,
  CreateSkipCashCheckoutSessionDto,
} from './dto/order.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Cart, CartDocument } from '../cart/schemas/cart.schema';
import { Settings, SettingsDocument } from '../settings/settings.schema';
import { Offer, OfferDocument } from '../offers/schemas/offer.schema';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { SMSService } from '../sms/sms.service';
import { MailService } from '../auth/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { convertToGrams } from '../../utils/unitConversion';
import { normalizePhone } from '../../utils/phone';

@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Review.name) private reviewModel: Model<ReviewDocument>,
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
    @InjectModel(Offer.name) private offerModel: Model<OfferDocument>,
    private configService: ConfigService,
    private whatsAppService: WhatsAppService,
    private smsService: SMSService,
    private mailService: MailService,
    private notificationsService: NotificationsService,
    private loyaltyService: LoyaltyService,
  ) {}

  async onModuleInit() {
    // Start periodic scanner to process scheduled review requests/reminders every minute
    const scanIntervalMs = Math.max(30 * 1000, Number(this.configService.get('REVIEW_SCHEDULER_INTERVAL_MS', 60 * 1000)));
    setInterval(() => this.processScheduledReviews().catch(() => null), scanIntervalMs);
    // Schedule daily inventory summary (default every 24h)
    const inventoryIntervalMs = Math.max(
      60 * 60 * 1000,
      Number(this.configService.get('INVENTORY_SUMMARY_INTERVAL_MS', 24 * 60 * 60 * 1000)),
    );
    setInterval(() => this.processInventorySummary().catch(() => null), inventoryIntervalMs);
  }

  private async processInventorySummary() {
    try {
      // Find products at or below their lowStockThreshold (or default 10)
      const products = await this.productModel.find({}).select('name stock lowStockThreshold').lean();
      const lowItems: Array<{ name: string; stock: number }> = [];
      for (const p of products) {
        const threshold = (p as any).lowStockThreshold ?? 10;
        if ((p as any).stock <= threshold) {
          lowItems.push({ name: p.name, stock: p.stock });
        }
      }

      if (lowItems.length === 0) return;

      // Compose message and notify admins
      const lines = lowItems.slice(0, 50).map((i) => `${i.name} — ${i.stock}`).join('\n');
      const summaryMsg = `Inventory summary: ${lowItems.length} low/out-of-stock items\n\n${lines}`;

      await this.notificationsService.notifyAdmins('Inventory Summary', summaryMsg, 'inventory', { items: lowItems });

      // Send WhatsApp summary to admin number
      await this.whatsAppService.sendInventorySummary('admin', lowItems);
    } catch (e) {
      console.error('Inventory summary job failed', e);
    }
  }

  private async processScheduledReviews() {
    const now = new Date();

    // Initial review requests (e.g., 6h after delivered)
    const initialDue = await this.orderModel.find({
      feedbackRating: { $exists: false },
      reviewRequestScheduledAt: { $lte: now },
    }).limit(50).lean();

    for (const o of initialDue) {
      try {
        const order = await this.orderModel.findById(o._id);
        if (!order) continue;
        if (order.feedbackRating) continue; // already reviewed

        const googleReviewLink = this.configService.get('GOOGLE_REVIEW_LINK') || 'https://g.page/r/alfursan-oud/review';
        await this.mailService.sendFeedbackRequest(
          order.customer.email,
          order.customer.name,
          order.orderNumber,
          googleReviewLink,
          order._id.toString(),
        );
        await this.whatsAppService.sendFeedbackRequest(
          order.customer.phone || '',
          order.customer.name || '',
          order.orderNumber,
          googleReviewLink,
          order._id.toString(),
        );

        // mark that initial request was sent
        order.reviewRequestScheduledAt = undefined as any;
        order.feedbackRequested = true;
        await order.save();
      } catch (e) { /* ignore individual failures */ }
    }

    // Reminders (e.g., 24h after delivered) send only if still no feedback
    const reminderDue = await this.orderModel.find({
      feedbackRating: { $exists: false },
      reviewReminderScheduledAt: { $lte: now },
    }).limit(50).lean();

    for (const o of reminderDue) {
      try {
        const order = await this.orderModel.findById(o._id);
        if (!order) continue;
        if (order.feedbackRating) continue; // already reviewed

        const googleReviewLink = this.configService.get('GOOGLE_REVIEW_LINK') || 'https://g.page/r/alfursan-oud/review';
        await this.mailService.sendFeedbackRequest(
          order.customer.email,
          order.customer.name,
          order.orderNumber,
          googleReviewLink,
          order._id.toString(),
        );
        await this.whatsAppService.sendFeedbackRequest(
          order.customer.phone || '',
          order.customer.name || '',
          order.orderNumber,
          googleReviewLink,
          order._id.toString(),
        );

        order.reviewReminderScheduledAt = undefined as any;
        await order.save();
      } catch (e) { /* ignore */ }
    }
  }

  private generateOrderNumber(): string {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${y}${m}-${rand}`;
  }

  // ─── Calculate loyalty points based on order total and customer tier ───
  private calculateLoyaltyPoints(total: number, tier: string = 'silver'): number {
    return this.loyaltyService.calculatePointsForOrder(total, tier);
  }

  private normalizeLoyaltyTier(tier?: string): 'silver' | 'gold' | 'platinum' {
    const normalized = String(tier || '').trim().toLowerCase();
    if (normalized === 'gold') return 'gold';
    if (normalized === 'platinum') return 'platinum';
    // Backward compatibility: treat legacy/unknown tiers (e.g. bronze) as silver.
    return 'silver';
  }

  private async resolveOrderDiscount(code: string | undefined, subtotal: number): Promise<{ code: string; discount: number; offerId?: string }> {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) return { code: '', discount: 0 };

    const now = new Date();
    const offer = await this.offerModel.findOne({
      code: normalizedCode,
      isActive: true,
      $or: [
        { startDate: { $exists: false }, endDate: { $exists: false } },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: { $exists: false } },
        { startDate: { $exists: false }, endDate: { $gte: now } },
      ],
    }).lean();

    if (!offer) {
      throw new BadRequestException('Invalid or expired discount code');
    }

    if (offer.usageLimit && offer.usageCount >= offer.usageLimit) {
      throw new BadRequestException('This discount code has reached its usage limit');
    }

    if (offer.minOrder && subtotal < offer.minOrder) {
      throw new BadRequestException(`Minimum order amount is ${offer.minOrder} QAR`);
    }

    let discount = 0;
    if (offer.type === 'percentage') {
      discount = (subtotal * (offer.value || 0)) / 100;
      if (offer.maxDiscount) discount = Math.min(discount, offer.maxDiscount);
    } else if (offer.type === 'fixed') {
      discount = Number(offer.value || 0);
    }

    return {
      code: normalizedCode,
      discount: Math.max(0, Math.min(discount, subtotal)),
      offerId: String(offer._id),
    };
  }

  private isPaidStatus(status: string) {
    return status === 'paid';
  }

  private isDuplicatePaymentIdError(error: any): boolean {
    return error?.code === 11000
      && (
        !!error?.keyPattern?.paymentId
        || String(error?.message || '').includes('paymentId')
      );
  }

  private logWhatsAppFailure(action: string, orderNumber: string) {
    console.warn(`⚠️ WhatsApp ${action} notification failed for order ${orderNumber}`);
  }

  private safeCustomerName(name?: string): string {
    return (name || '').trim() || 'Valued Customer';
  }

  private async ensurePaymentMethodEnabled(paymentMethod: string) {
    const settings = await this.settingsModel.findOne().lean();
    if (!settings) return;

    const codEnabled = settings.cashOnDeliveryEnabled !== false;
    const skipCashEnabled = (settings as any).skipCashEnabled !== false;

    if (paymentMethod === 'cod' && !codEnabled) {
      throw new BadRequestException('Cash on Delivery is currently disabled');
    }

    if (paymentMethod === 'skipcash' && !skipCashEnabled) {
      throw new BadRequestException('SkipCash is currently disabled');
    }
  }

  private normalizeSkipCashStatus(rawStatus: string): 'paid' | 'failed' | 'pending' {
    const value = String(rawStatus || '').toLowerCase();
    if (!value) return 'pending';
    if (
      value.includes('paid')
      || value.includes('success')
      || value.includes('succeeded')
      || value.includes('captured')
      || value.includes('approved')
      || value.includes('complete')
    ) {
      return 'paid';
    }
    if (
      value.includes('fail')
      || value.includes('cancel')
      || value.includes('declin')
      || value.includes('error')
      || value.includes('reject')
    ) {
      return 'failed';
    }
    return 'pending';
  }

  private extractSkipCashOrderRef(payload: any): string {
    return String(
      payload?.orderId
      || payload?.order_id
      || payload?.merchantOrderId
      || payload?.merchant_order_id
      || payload?.reference
      || payload?.reference_id
      || payload?.metadata?.orderId
      || payload?.metadata?.order_id
      || '',
    );
  }

  private extractSkipCashMetadata(payload: any): any {
    return payload?.metadata || payload?.metaData || payload?.merchantMetaData || payload?.merchant_metadata || {};
  }

  private buildSkipCashEndpointCandidates(configuredApiUrl: string): string[] {
    return Array.from(new Set([
      configuredApiUrl,
      configuredApiUrl.replace('/v1/', '/api/v1/'),
      'https://api.skipcash.app/api/v1/payments',
    ]));
  }

  private getSkipCashSecrets(): string[] {
    const singleSecret = (this.configService.get<string>('SKIPCASH_SECRET') || '').trim();
    const multipleSecretsRaw = this.configService.get<string>('SKIPCASH_SECRETS') || '';

    const multipleSecrets = multipleSecretsRaw
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean);

    return Array.from(new Set([singleSecret, ...multipleSecrets].filter(Boolean)));
  }

  private buildSkipCashPayloadCandidates(payload: any): any[] {
    const snakeCasePayload = {
      ...payload,
      order_id: payload?.orderId,
      order_number: payload?.orderNumber,
      success_url: payload?.successUrl,
      cancel_url: payload?.cancelUrl,
      webhook_url: payload?.webhookUrl,
      merchant_order_id: payload?.orderId,
      customer_name: payload?.customer?.name,
      customer_email: payload?.customer?.email,
      customer_phone: payload?.customer?.phone,
      merchant_metadata: payload?.merchantMetaData || payload?.metadata,
    };

    return [payload, snakeCasePayload];
  }

  private normalizeWebhookKey(value?: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (raw.toLowerCase().startsWith('bearer ')) {
      return raw.slice(7).trim();
    }

    return raw;
  }

  private getConfiguredWebhookKeys(): string[] {
    const primary = this.normalizeWebhookKey(this.configService.get<string>('SKIPCASH_WEBHOOK_KEY') || '');
    const additionalRaw = this.configService.get<string>('SKIPCASH_WEBHOOK_KEYS') || '';
    const additional = additionalRaw
      .split(/[\n,]/)
      .map((key) => this.normalizeWebhookKey(key))
      .filter(Boolean);

    return Array.from(new Set([primary, ...additional].filter(Boolean)));
  }

  private isPublicBackendUrl(value: string): boolean {
    if (!value) return false;

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return false;
      }

      // SkipCash callback must be reachable from the internet.
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private resolveSkipCashWebhookUrl(backendUrl: string): string {
    const explicitWebhookUrl = (this.configService.get<string>('SKIPCASH_WEBHOOK_URL') || '').trim();
    if (explicitWebhookUrl) {
      return explicitWebhookUrl;
    }

    if (this.isPublicBackendUrl(backendUrl)) {
      return `${backendUrl.replace(/\/+$/, '')}/api/orders/skipcash/webhook`;
    }

    // In localhost development, SkipCash session can still be created without webhook_url.
    // Merchants can configure a dashboard webhook or provide SKIPCASH_WEBHOOK_URL via tunnel.
    return '';
  }

  private resolveSkipCashReturnUrls(params: {
    frontendUrl: string;
    successPath: string;
    cancelPath: string;
    requestedSuccessUrl?: string;
    requestedCancelUrl?: string;
  }): { successUrl: string; cancelUrl: string } {
    const {
      frontendUrl,
      successPath,
      cancelPath,
      requestedSuccessUrl,
      requestedCancelUrl,
    } = params;

    const envSuccessUrl = (this.configService.get<string>('SKIPCASH_SUCCESS_URL') || '').trim();
    const envCancelUrl = (this.configService.get<string>('SKIPCASH_CANCEL_URL') || '').trim();

    const successUrl = (requestedSuccessUrl || '').trim()
      || envSuccessUrl
      || (this.isPublicBackendUrl(frontendUrl) ? `${frontendUrl.replace(/\/+$/, '')}${successPath}` : '');

    const cancelUrl = (requestedCancelUrl || '').trim()
      || envCancelUrl
      || (this.isPublicBackendUrl(frontendUrl) ? `${frontendUrl.replace(/\/+$/, '')}${cancelPath}` : '');

    return { successUrl, cancelUrl };
  }

  private getSkipCashClientIdentifiers(): string[] {
    const keyId = (this.configService.get<string>('SKIPCASH_KEY_ID') || '').trim();
    const clientId = (this.configService.get<string>('SKIPCASH_CLIENT_ID') || '').trim();
    return Array.from(new Set([keyId, clientId].filter(Boolean)));
  }

  private async requestSkipCashSession(payload: any) {
    // Per SkipCash official docs: use single endpoint and minimal headers
    const keyId = (this.configService.get<string>('SKIPCASH_KEY_ID') || '').trim();
    const secret = (this.configService.get<string>('SKIPCASH_SECRET') || '').trim();

    if (!keyId || !secret) {
      throw new BadRequestException('SKIPCASH_KEY_ID and SKIPCASH_SECRET must be configured');
    }

    // Extract customer and transaction info
    const uid = uuidv4();
    const amountStr = String(payload?.amount ?? '').padEnd(2, '0') || '0.00';
    const fullName = String(payload?.customer?.name || '').trim();
    const names = fullName ? fullName.split(/\s+/) : [];
    const firstName = names.length > 0 ? names[0] : '';
    const lastName = names.length > 1 ? names.slice(1).join(' ') : '';
    const phone = String(payload?.customer?.phone || '').trim();
    const email = String(payload?.customer?.email || '').trim();
    const transactionId = String(payload?.orderId || payload?.orderNumber || '');
    const custom1 = String((payload?.metadata && (payload.metadata.draftReference || payload.metadata.draft_token)) || payload?.merchantMetaData?.draftReference || '');

    // Validate required fields (SkipCash returns 400 "Invalid details!" if any are missing)
    if (!firstName) {
      throw new BadRequestException('Customer first name is required for SkipCash payment');
    }
    if (!lastName) {
      throw new BadRequestException('Customer last name is required for SkipCash payment');
    }
    if (!phone) {
      throw new BadRequestException('Customer phone number is required for SkipCash payment');
    }
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Valid customer email is required for SkipCash payment');
    }
    if (!transactionId) {
      throw new BadRequestException('Transaction ID (orderId) is required for SkipCash payment');
    }

    // Build combined data with ONLY NON-EMPTY FIELDS (per SkipCash docs: "Combine not empty request fields")
    // Order is critical: Uid, KeyId, Amount, FirstName, LastName, Phone, Email, [optional fields]
    const combinedDataParts: string[] = [
      `Uid=${uid}`,
      `KeyId=${keyId}`,
      `Amount=${amountStr}`,
      `FirstName=${firstName}`,
      `LastName=${lastName}`,
      `Phone=${phone}`,
      `Email=${email}`,
    ];
    
    // Only add optional fields if they have values
    if (transactionId) combinedDataParts.push(`TransactionId=${transactionId}`);
    if (custom1) combinedDataParts.push(`Custom1=${custom1}`);
    
    const combinedData = combinedDataParts.join(',');

    // Compute HMAC-SHA256 using crypto-js (matches SkipCash docs exactly)
    let authorizationHeader = '';
    try {
      const combinedDataHash = CryptoJS.HmacSHA256(combinedData, secret);
      authorizationHeader = CryptoJS.enc.Base64.stringify(combinedDataHash);
    } catch (e) {
      console.error('HMAC computation failed', e);
      throw new BadRequestException('Failed to compute SkipCash authentication signature');
    }

    // Request body must ONLY include non-empty fields (must match HMAC signature)
    // Do NOT include empty Street, City, State, Country, PostalCode fields
    const bodyToSend: any = {
      Uid: uid,
      KeyId: keyId,
      Amount: amountStr,
      FirstName: firstName,
      LastName: lastName,
      Phone: phone,
      Email: email,
    };

    // Only add optional fields if they have values
    if (transactionId) bodyToSend.TransactionId = transactionId;
    if (custom1) bodyToSend.Custom1 = custom1;

    const endpoint = 'https://api.skipcash.app/api/v1/payments';
    const headers = {
      'Authorization': authorizationHeader,
      'Content-Type': 'application/json',
    };

    let responseBody: any = {};
    let responseStatus = 0;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyToSend),
      });

      responseStatus = response.status;
      const responseText = await response.text();
      try {
        responseBody = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseBody = { raw: responseText };
      }

      if (!response.ok) {
        const providerMessage = String(
          responseBody?.message
          || responseBody?.error
          || responseBody?.msg
          || responseBody?.detail
          || responseBody?.errorMessage
          || (Array.isArray(responseBody?.errors) ? responseBody.errors.map((e: any) => String(e?.message || e?.msg || e || '')).filter(Boolean).join('; ') : '')
          || responseBody?.raw
          || '',
        ).trim();

        const errorDetail = `SkipCash rejected request (${responseStatus}): ${providerMessage || 'Unknown error'}`;
        console.error('SkipCash request failed', {
          keyId,
          firstName,
          lastName,
          phone,
          email,
          amount: amountStr,
          errorMessage: providerMessage,
        });

        throw new BadRequestException(errorDetail);
      }
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('SkipCash request failed', error);
      throw new BadRequestException(`SkipCash communication failed: ${error.message || 'Unknown error'}`);
    }

    // Extract checkout URL and payment ID from response
    const checkoutUrl =
      responseBody?.resultObj?.payUrl
      || responseBody?.resultObj?.CheckoutUrl
      || responseBody?.checkoutUrl
      || responseBody?.paymentUrl
      || responseBody?.url
      || responseBody?.redirectUrl
      || responseBody?.data?.payUrl
      || responseBody?.data?.checkoutUrl
      || responseBody?.data?.paymentUrl
      || responseBody?.data?.url;

    const paymentId =
      responseBody?.resultObj?.id
      || responseBody?.resultObj?.PaymentId
      || responseBody?.paymentId
      || responseBody?.transactionId
      || responseBody?.id
      || responseBody?.data?.id
      || responseBody?.data?.paymentId
      || responseBody?.data?.transactionId
      || '';

    if (!checkoutUrl) {
      throw new BadRequestException('SkipCash response did not include a checkout URL');
    }

    const checkoutHost = (() => {
      try {
        return new URL(String(checkoutUrl)).host.toLowerCase();
      } catch {
        return '';
      }
    })();

    if (!checkoutHost.includes('skipcash')) {
      throw new BadRequestException('SkipCash did not return a valid hosted checkout URL. Payment was not processed. Please verify SKIPCASH credentials/config.');
    }

    return {
      checkoutUrl: String(checkoutUrl),
      paymentId: paymentId ? String(paymentId) : '',
    };
  }

  async createSkipCashCheckoutSession(userId: string, dto: CreateSkipCashCheckoutSessionDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    await this.ensurePaymentMethodEnabled('skipcash');
    await this.validateStock(dto.items);

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const discountResolution = await this.resolveOrderDiscount(dto.discountCode, subtotal);
    const shippingCost = 0; // Shipping is always free
    const total = Math.max(0, subtotal - discountResolution.discount + shippingCost);

    const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:5000';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const draftReference = `SKP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const { successUrl, cancelUrl } = this.resolveSkipCashReturnUrls({
      frontendUrl,
      successPath: `/checkout/skipcash/success?draftRef=${draftReference}`,
      cancelPath: `/checkout/skipcash/cancel?draftRef=${draftReference}`,
      requestedSuccessUrl: dto?.successUrl,
      requestedCancelUrl: dto?.cancelUrl,
    });
    const webhookUrl = this.resolveSkipCashWebhookUrl(backendUrl);

    const draftOrder = {
      userId,
      orderData: {
        items: dto.items,
        shippingAddress: dto.shippingAddress,
        paymentMethod: 'skipcash',
        discountCode: discountResolution.code,
        notes: dto.notes || '',
        customer: dto.customer,
      },
    };
    const draftToken = Buffer.from(JSON.stringify(draftOrder), 'utf8').toString('base64');

    const payload = {
      clientId: this.getSkipCashClientIdentifiers()[0] || '',
      amount: total.toFixed(2),
      currency: 'QAR',
      orderId: draftReference,
      orderNumber: draftReference,
      customer: {
        name: dto.customer?.name?.trim() || user.fullName,
        email: dto.customer?.email?.trim() || user.email,
        phone: dto.customer?.phone?.trim() || user.phone || '',
      },
      ...(successUrl ? { successUrl } : {}),
      ...(cancelUrl ? { cancelUrl } : {}),
      ...(webhookUrl ? { webhookUrl } : {}),
      metadata: {
        draftReference,
        draftToken,
      },
      merchantMetaData: {
        draftReference,
        draftToken,
      },
    };

    const session = await this.requestSkipCashSession(payload);

    return {
      checkoutUrl: session.checkoutUrl,
      paymentId: session.paymentId,
      draftReference,
    };
  }

  async createSkipCashSession(userId: string, orderId: string, dto?: CreateSkipCashSessionDto) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (String(order.user) !== String(userId)) {
      throw new BadRequestException('Order does not belong to current user');
    }
    if (order.paymentMethod !== 'skipcash') {
      throw new BadRequestException('SkipCash session can only be created for skipcash orders');
    }

    await this.ensurePaymentMethodEnabled('skipcash');

    // Get user data for fallbacks
    const user = await this.userModel.findById(userId).select('fullName email phone').lean();

    const backendUrl = this.configService.get<string>('BACKEND_URL') || 'http://localhost:5000';
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';

    const { successUrl, cancelUrl } = this.resolveSkipCashReturnUrls({
      frontendUrl,
      successPath: `/checkout/skipcash/success?orderId=${order._id}`,
      cancelPath: `/checkout/skipcash/cancel?orderId=${order._id}`,
      requestedSuccessUrl: dto?.successUrl,
      requestedCancelUrl: dto?.cancelUrl,
    });
    const webhookUrl = this.resolveSkipCashWebhookUrl(backendUrl);

    const payload = {
      clientId: this.getSkipCashClientIdentifiers()[0] || '',
      amount: order.total.toFixed(2),
      currency: 'QAR',
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      customer: {
        name: order.customer?.name || user?.fullName || '',
        email: order.customer?.email || user?.email || '',
        phone: order.customer?.phone || user?.phone || '',
      },
      ...(successUrl ? { successUrl } : {}),
      ...(cancelUrl ? { cancelUrl } : {}),
      ...(webhookUrl ? { webhookUrl } : {}),
    };
    const session = await this.requestSkipCashSession(payload);

    const historyEntry = {
      status: 'payment_session_created',
      timestamp: new Date(),
      note: 'SkipCash session initialized',
      updatedBy: 'system',
    };

    await this.orderModel.findByIdAndUpdate(order._id, {
      $set: session.paymentId ? { paymentId: String(session.paymentId) } : {},
      $push: { statusHistory: historyEntry },
    });

    return {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      checkoutUrl: String(session.checkoutUrl),
      paymentId: session.paymentId ? String(session.paymentId) : '',
    };
  }

  async processSkipCashWebhook(payload: any, webhookKeyHeader?: string) {
    const expectedKeys = this.getConfiguredWebhookKeys();
    const providedWebhookKey = this.normalizeWebhookKey(webhookKeyHeader);

    if (expectedKeys.length > 0 && !expectedKeys.includes(providedWebhookKey)) {
      console.warn('[SkipCash Webhook] Invalid webhook key provided');
      throw new BadRequestException('Invalid SkipCash webhook key');
    }

    const metadata = this.extractSkipCashMetadata(payload);
    const draftTokenFromMetadata = String(metadata?.draftToken || metadata?.draft_token || '');
    const orderRef = this.extractSkipCashOrderRef(payload);
    
    console.log('[SkipCash Webhook] Processing:', {
      orderRef,
      hasDraftToken: !!draftTokenFromMetadata,
      status: payload?.status || payload?.paymentStatus || 'unknown',
    });

    if (!orderRef && !draftTokenFromMetadata) {
      console.error('[SkipCash Webhook] Missing order reference and draft token');
      throw new BadRequestException('SkipCash webhook payload missing order reference and draft token');
    }

    let order = Types.ObjectId.isValid(orderRef)
      ? await this.orderModel.findById(orderRef)
      : null;

    if (!order) {
      order = await this.orderModel.findOne({ orderNumber: orderRef });
    }

    const paymentId = String(
      payload?.paymentId
      || payload?.payment_id
      || payload?.transactionId
      || payload?.transaction_id
      || payload?.id
      || order?.paymentId
      || '',
    );

    const rawStatus = String(
      payload?.status
      || payload?.paymentStatus
      || payload?.payment_status
      || payload?.result
      || payload?.event
      || '',
    );
    const normalizedStatus = this.normalizeSkipCashStatus(rawStatus);

    if (paymentId && normalizedStatus === 'paid') {
      const existingByPaymentId = await this.orderModel.findOne({ paymentId, paymentMethod: 'skipcash' });
      if (existingByPaymentId) {
        return {
          message: 'SkipCash webhook already processed',
          status: normalizedStatus,
          orderId: String(existingByPaymentId._id),
          orderNumber: existingByPaymentId.orderNumber,
          paymentId,
        };
      }
    }

    if (order) {
      const result = await this.updatePayment(
        String(order._id),
        {
          paymentStatus: normalizedStatus,
          paymentMethod: 'skipcash',
          paymentId,
          notes: `SkipCash webhook: ${rawStatus || 'unknown status'}`,
        },
        'skipcash_webhook',
      );

      return {
        message: 'SkipCash webhook processed',
        status: normalizedStatus,
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        paymentId,
        result,
      };
    }

    if (normalizedStatus !== 'paid') {
      return {
        message: 'SkipCash webhook received for non-paid draft checkout',
        status: normalizedStatus,
        orderReference: orderRef,
        paymentId,
      };
    }

    const draftToken = draftTokenFromMetadata;
    if (!draftToken) {
      throw new NotFoundException('Order not found for SkipCash webhook and no draft checkout token provided');
    }

    let draftData: any;
    try {
      draftData = JSON.parse(Buffer.from(draftToken, 'base64').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid SkipCash draft checkout token');
    }

    if (!draftData?.userId || !draftData?.orderData) {
      throw new BadRequestException('SkipCash draft checkout token is incomplete');
    }

    let created: any;
    try {
      console.log('[SkipCash Webhook] Creating order from draft token for userId:', draftData.userId);
      created = await this.create(draftData.userId, {
        ...draftData.orderData,
        paymentMethod: 'skipcash',
        paymentId,
      });
      console.log('[SkipCash Webhook] Order created successfully:', created.order?.id || created.order?.orderNumber);
    } catch (error: any) {
      console.error('[SkipCash Webhook] Order creation failed:', error.message);
      if (this.isDuplicatePaymentIdError(error) && paymentId) {
        const existing = await this.orderModel.findOne({ paymentId, paymentMethod: 'skipcash' });
        if (existing) {
          console.log('[SkipCash Webhook] Duplicate payment detected, returning existing order:', existing.orderNumber);
          return {
            message: 'SkipCash webhook already processed',
            status: normalizedStatus,
            orderId: String(existing._id),
            orderNumber: existing.orderNumber,
            paymentId,
          };
        }
      }
      throw error;
    }

    return {
      message: 'SkipCash webhook processed and order created',
      status: normalizedStatus,
      paymentId,
      result: created,
    };
  }

  async deleteOrder(
    id: string,
    auditContext?: {
      adminId?: string;
      adminName?: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    // Save order data before deletion for audit trail
    const deletedOrderData = {
      orderNumber: order.orderNumber,
      customer: order.customer,
      total: order.total,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      createdAt: order.createdAt,
    };

    if (!['cancelled', 'delivered'].includes(order.status)) {
      await this.restoreStock(order.items as any);
    }

    // Delete the order
    await this.orderModel.findByIdAndDelete(id);

    // Create audit log
    try {
      await this.auditLogModel.create({
        action: 'delete',
        entityType: 'order',
        entityId: new Types.ObjectId(id),
        entityNumber: order.orderNumber,
        performedBy: auditContext?.adminId ? new Types.ObjectId(auditContext.adminId) : undefined,
        performedByName: auditContext?.adminName || 'system',
        changes: deletedOrderData,
        ipAddress: auditContext?.ipAddress,
        userAgent: auditContext?.userAgent,
        details: `Order deleted by ${auditContext?.adminName || 'system'} - Customer: ${order.customer.name}`,
      });
    } catch (e) {
      // Log audit error but don't fail the delete operation
      console.error('Failed to create audit log for order deletion', e);
    }

    return {
      message: 'Order deleted successfully',
      orderNumber: order.orderNumber,
      deletedAt: new Date(),
      auditedBy: auditContext?.adminName || 'system',
    };
  }

  private async validateStock(items: any[]) {
    for (const item of items) {
      if (!item.product) {
        throw new BadRequestException(`Product reference is required for item "${item.name}"`);
      }

      const product = await this.productModel.findById(item.product);
      if (!product) {
        throw new BadRequestException(`Product not found: ${item.name}`);
      }

      const unit = (item as any).unit || (product as any).unit || 'Grams';
      // Convert requested quantity to base inventory unit (Grams)
      const requiredStockInGrams = convertToGrams(item.quantity, unit);

      if (product.stock <= 0) {
        throw new BadRequestException(`Product "${product.name}" is out of stock`);
      }
      if (product.stock < requiredStockInGrams) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". Available: ${product.stock} ${unit}, Requested: ${item.quantity} ${unit}`,
        );
      }
    }
  }

  private async sendPaymentReceiptAndScheduleReview(
    order: OrderDocument,
    customerEmail: string,
    customerPhone: string,
    customerName: string,
  ) {
    const paymentLabel = order.paymentMethod.replace(/_/g, ' ');

    try {
      await this.mailService.sendPaymentReceipt(
        customerEmail,
        customerName,
        order.orderNumber,
        order.total,
        paymentLabel,
        order.items as any,
      );
    } catch (e) { }

    const paymentReceiptSent = await this.whatsAppService.sendPaymentReceipt(
      customerPhone,
      customerName,
      order.orderNumber,
      order.total,
      paymentLabel,
      order.items as any,
    );
    if (!paymentReceiptSent) {
      this.logWhatsAppFailure('payment receipt', order.orderNumber);
    }

    const initialHours = Number(this.configService.get('REVIEW_REQUEST_INITIAL_HOURS', 6));
    const reminderHours = Number(this.configService.get('REVIEW_REQUEST_REMINDER_HOURS', 24));
    const initialMs = Math.max(0, Math.floor(initialHours * 60 * 60 * 1000));
    const reminderMs = Math.max(0, Math.floor(reminderHours * 60 * 60 * 1000));

    await this.orderModel.findByIdAndUpdate(order._id, {
      reviewRequestScheduledAt: new Date(Date.now() + initialMs),
      reviewReminderScheduledAt: new Date(Date.now() + reminderMs),
    });
  }

  // ─── Determine customer type based on order history ───
  private async updateCustomerType(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) return;

    const orderCount = await this.orderModel.countDocuments({
      user: new Types.ObjectId(userId),
      status: 'delivered',
    });

    let customerType = 'new';
    if (orderCount >= 10 || user.totalSpent >= 5000) customerType = 'vip';
    else if (orderCount >= 3) customerType = 'returning';

    await this.userModel.findByIdAndUpdate(userId, {
      customerType,
      lastOrderDate: new Date(),
    });
  }

  // ─── Deduct stock for order items ───
  private async deductStock(items: any[]) {
    for (const item of items) {
      if (item.product) {
        const product = await this.productModel.findById(item.product);
        if (!product) continue;

        const unit = (item as any).unit || (product as any).unit || 'Grams';
        // Convert quantity to base inventory unit (Grams)
        const stockToDeduct = convertToGrams(item.quantity, unit);

        const updatedProduct = await this.productModel.findByIdAndUpdate(
          item.product,
          {
            $inc: { stock: -stockToDeduct, sales: item.quantity },
          },
          { returnDocument: 'after' },
        );

        // Check low stock using per-product threshold
        if (updatedProduct) {
          const threshold = (updatedProduct as any).lowStockThreshold || 10;
          // Get the storage unit for the alert message
          const storageUnit = unit === 'Tola' || unit === 'kg' ? 'Grams' : unit;
          if (updatedProduct.stock <= threshold && updatedProduct.stock >= 0) {
            const alertMsg = `Product ${updatedProduct.name} is almost out of stock. Remaining quantity: ${updatedProduct.stock} ${storageUnit}.`;
            await this.notificationsService.notifyAdmins(
              'Low Stock Alert',
              alertMsg,
              'stock',
            );
            await this.whatsAppService.sendLowStockAlert('admin', updatedProduct.name, updatedProduct.stock);
            // Send email alert
            try {
              await this.mailService.sendLowStockAlert(updatedProduct.name, updatedProduct.stock, storageUnit);
            } catch (e) { /* email failure should not block */ }
          }
        }
      }
    }
  }

  // ─── Restore stock on cancellation ───
  private async restoreStock(items: any[]) {
    for (const item of items) {
      if (item.product) {
        const product = await this.productModel.findById(item.product);
        if (!product) continue;

        const unit = (item as any).unit || (product as any).unit || 'Grams';
        // Convert quantity to base inventory unit (Grams)
        const stockToRestore = convertToGrams(item.quantity, unit);

        await this.productModel.findByIdAndUpdate(item.product, {
          $inc: { stock: stockToRestore, sales: -item.quantity },
        });
      }
    }
  }

  private normalizeOrderItemsForCreate(items: Array<{
    product?: string;
    name: string;
    nameAr?: string;
    price: number;
    quantity: number;
    image?: string;
    unit?: string;
    pricePerUnit?: number;
  }>) {
    return items.map((item) => ({
      product: item.product ? new Types.ObjectId(item.product) : undefined,
      name: item.name,
      nameAr: item.nameAr || '',
      price: item.price,
      quantity: item.quantity,
      image: item.image || '',
      unit: item.unit || 'Grams',
      pricePerUnit: item.pricePerUnit || 0,
    }));
  }

  async create(userId: string, dto: CreateOrderDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    await this.validateStock(dto.items);

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingCost = 0; // Shipping is always free
    
    // Check if this is a first order and apply 10% discount
    const previousOrders = await this.orderModel.countDocuments({ user: userId });
    let discount = 0;
    let discountReason = '';
    if (previousOrders === 0) {
      discount = Math.round(subtotal * 0.1); // 10% first order discount
      discountReason = 'First order discount (10%)';
    }

    const coupon = await this.resolveOrderDiscount(dto.discountCode, subtotal);
    if (coupon.discount > 0) {
      discount += coupon.discount;
      discountReason = discountReason
        ? `${discountReason} + Coupon (${coupon.code})`
        : `Coupon (${coupon.code})`;
    }

    // Handle loyalty discount
    let loyaltyDiscount = 0;
    let loyaltyPointsUsed = 0;
    if (dto.loyaltyDiscount && dto.loyaltyDiscount > 0) {
      // Validate loyalty discount doesn't exceed order total
      const orderTotalBeforeLoyalty = Math.max(0, subtotal - discount + shippingCost);
      loyaltyDiscount = Math.min(dto.loyaltyDiscount, orderTotalBeforeLoyalty);
      
      // Deduct points for the loyalty discount
      try {
        const redemptionResult = await this.loyaltyService.redeemPointsForDiscount(
          userId,
          dto.loyaltyPointsToUse || 0,
          orderTotalBeforeLoyalty,
        );
        loyaltyPointsUsed = redemptionResult.pointsUsed;
        loyaltyDiscount = redemptionResult.discountAmount;
      } catch (e) {
        // If redemption fails, just ignore loyalty discount
        loyaltyDiscount = 0;
        loyaltyPointsUsed = 0;
      }
    }
    
    const total = Math.max(0, subtotal - discount - loyaltyDiscount + shippingCost);
    
    // Calculate loyalty points earned based on user's current tier (after discount applied)
    const userTier = this.normalizeLoyaltyTier(user.loyaltyTier);
    const loyaltyPoints = this.calculateLoyaltyPoints(total, userTier);

    const paymentMethod = dto.paymentMethod || 'cod';
    const country = dto.country || 'QA';
    const isInternational = country !== 'QA';

    // International orders must use online payment
    if (isInternational && !['skipcash', 'online', 'visa', 'mastercard', 'apple_pay', 'bank_transfer'].includes(paymentMethod)) {
      throw new BadRequestException('International orders require online payment method');
    }

    const allowedWebsiteMethods = ['cod', 'skipcash'];
    if (!isInternational && !allowedWebsiteMethods.includes(paymentMethod)) {
      throw new BadRequestException('Unsupported payment method for website checkout');
    }

    if (paymentMethod === 'skipcash' && !dto.paymentId) {
      throw new BadRequestException('SkipCash payment must be confirmed before creating the order');
    }

    if (paymentMethod === 'skipcash' && dto.paymentId) {
      const existingOrder = await this.orderModel.findOne({
        paymentMethod: 'skipcash',
        paymentId: dto.paymentId,
      });
      if (existingOrder) {
        return { message: 'Order already exists for this SkipCash payment', order: this.formatOrder(existingOrder) };
      }
    }

    await this.ensurePaymentMethodEnabled(paymentMethod);
    const isOnlineMethod = ['online', 'visa', 'mastercard', 'apple_pay', 'bank_transfer', 'local_gateway', 'skipcash'].includes(paymentMethod);
    const paymentStatus = isOnlineMethod && dto.paymentId ? 'paid' : 'pending';

    const customerName = dto.customer?.name?.trim() || user.fullName;
    const customerEmail = dto.customer?.email?.trim() || user.email;
    const customerPhone = normalizePhone(dto.customer?.phone?.trim() || user.phone || '');
    const normalizedItems = this.normalizeOrderItemsForCreate(dto.items);

    // Set estimated delivery date
    const estimatedDeliveryDate = new Date();
    if (isInternational) {
      estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + 5); // 5 days for international
    } else {
      estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + 3); // 3 days for local
    }

    let order: OrderDocument;
    try {
      // Always add payment_paid to statusHistory if paymentStatus is paid
      const statusHistory = [{ status: 'pending', timestamp: new Date(), note: 'Order placed' }];
      if (paymentStatus === 'paid') {
        statusHistory.push({ status: 'payment_paid', timestamp: new Date(), note: 'Payment confirmed' });
      }
      if (discount > 0) {
        statusHistory.push({ status: 'discount_applied', timestamp: new Date(), note: discountReason });
      }
      order = await this.orderModel.create({
        orderNumber: this.generateOrderNumber(),
        user: new Types.ObjectId(userId),
        customer: {
          name: customerName,
          email: customerEmail,
          phone: customerPhone,
        },
        items: normalizedItems,
        subtotal,
        discount,
        shippingCost,
        total,
        shippingAddress: dto.shippingAddress || '',
        country,
        isInternational,
        estimatedDeliveryDate,
        paymentMethod,
        paymentId: dto.paymentId || '',
        paymentStatus,
        salesChannel: dto.salesChannel || 'website',
        discountCode: coupon.code,
        notes: dto.notes || '',
        loyaltyPointsEarned: loyaltyPoints,
        loyaltyDiscount,
        loyaltyPointsUsed,
        loyaltyTierAtOrder: userTier,
        paymentCompletedAt: this.isPaidStatus(paymentStatus) ? new Date() : undefined,
        statusHistory,
      });
    } catch (error: any) {
      if (this.isDuplicatePaymentIdError(error) && paymentMethod === 'skipcash' && dto.paymentId) {
        const existingOrder = await this.orderModel.findOne({ paymentMethod: 'skipcash', paymentId: dto.paymentId });
        if (existingOrder) {
          return { message: 'Order already exists for this SkipCash payment', order: this.formatOrder(existingOrder) };
        }
      }
      throw error;
    }

    try {
      await this.deductStock(dto.items);
    } catch (error) {
      await this.orderModel.findByIdAndDelete(order._id).catch(() => null);
      throw error;
    }

    if (coupon.offerId) {
      await this.offerModel.findByIdAndUpdate(coupon.offerId, { $inc: { usageCount: 1 } }).catch(() => null);
    }

    // Clear user cart after successful order placement
    await this.cartModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $set: { items: [] } },
    ).catch(() => null);

    // Update user stats
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { totalOrders: 1, totalSpent: total },
    }).catch(() => null);

    // Update customer CRM type
    await this.updateCustomerType(userId).catch(() => null);

    if (this.isPaidStatus(paymentStatus)) {
      await this.sendPaymentReceiptAndScheduleReview(order, customerEmail, customerPhone, customerName);
    } else {
      try {
        await this.mailService.sendOrderConfirmation(
          customerEmail,
          customerName,
          order.orderNumber,
          order.total,
          order.items as any,
        );
      } catch (e) { }

      const confirmationSent = await this.whatsAppService.sendOrderConfirmation(
        customerPhone,
        customerName,
        order.orderNumber,
        order.total,
      );
      if (!confirmationSent) {
        this.logWhatsAppFailure('order confirmation', order.orderNumber);
      }

      // Send SMS order confirmation
      const smsConfirmationSent = await this.smsService.sendOrderConfirmationSMS(
        customerPhone,
        customerName,
        order,
      );
      if (!smsConfirmationSent.success) {
        console.warn('⚠️ SMS order confirmation failed:', smsConfirmationSent.error);
      }
    }

    // Notify admins (include salesChannel metadata)
    await this.notificationsService.notifyAdmins(
      'New Order',
      `Order ${order.orderNumber} placed by ${customerName} - ${total} QAR`,
      'order',
      { orderNumber: order.orderNumber, salesChannel: order.salesChannel || 'website', total },
    ).catch(() => null);

    // WhatsApp alert to admin
    const adminAlertSent = await this.whatsAppService.sendNewOrderAlert('admin', order.orderNumber, total);
    if (!adminAlertSent) {
      this.logWhatsAppFailure('new order alert', order.orderNumber);
    }

    return { message: 'Order created', order: this.formatOrder(order) };
  }

  async adminCreate(dto: AdminCreateOrderDto) {
    await this.validateStock(dto.items);

    if (!dto.customerPhone || !dto.customerPhone.trim()) {
      throw new BadRequestException('Customer phone is required');
    }

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const coupon = await this.resolveOrderDiscount(dto.discountCode, subtotal);
    const discount = coupon.discount;
    const total = Math.max(0, subtotal - discount);

    const normalizedPhone = normalizePhone(dto.customerPhone || '');
    const normalizedEmail = dto.customerEmail?.trim().toLowerCase();

    let user = normalizedPhone
      ? await this.userModel.findOne({ phone: normalizedPhone })
      : null;

    if (!user && normalizedEmail) {
      user = await this.userModel.findOne({ email: normalizedEmail });
    }

    if (!user) {
      const generatedEmail = normalizedEmail || `walkin-${Date.now()}-${Math.floor(Math.random() * 10000)}@local.customer`;
      const passwordHash = await bcrypt.hash(uuidv4(), 12);

      user = await this.userModel.create({
        fullName: dto.customerName,
        email: generatedEmail,
        phone: normalizedPhone,
        password: passwordHash,
        role: 'user',
        isVerified: true,
        address: '',
      });
    }

    const userId = user._id;
    const email = user.email;

    const paymentMethod = dto.paymentMethod || 'cash';
    const paymentStatus = dto.paymentStatus || (['cash', 'pos_machine', 'card_on_delivery'].includes(paymentMethod) ? 'paid' : 'pending');
    const orderStatus = this.isPaidStatus(paymentStatus) ? 'processing' : 'pending';
    const normalizedItems = this.normalizeOrderItemsForCreate(dto.items);
    const salesChannel = dto.salesChannel || 'store';
    const shippingAddress = salesChannel === 'store' ? '' : (dto.shippingAddress || '');

    const order = await this.orderModel.create({
      orderNumber: this.generateOrderNumber(),
      user: userId,
      customer: {
        name: dto.customerName,
        email,
        phone: normalizedPhone,
      },
      items: normalizedItems,
      subtotal,
      discount,
      shippingCost: 0,
      total,
      shippingAddress,
      discountCode: coupon.code,
      paymentMethod,
      paymentStatus,
      status: orderStatus,
      salesChannel,
      paymentCompletedAt: this.isPaidStatus(paymentStatus) ? new Date() : undefined,
      statusHistory: [
        { status: 'pending', timestamp: new Date(), note: 'Admin created order' },
        { status: orderStatus, timestamp: new Date(), note: 'Admin created order' },
      ],
    });

    // Deduct stock
    await this.deductStock(dto.items);

    if (coupon.offerId) {
      await this.offerModel.findByIdAndUpdate(coupon.offerId, { $inc: { usageCount: 1 } }).catch(() => null);
    }

    // If order was created from store (in‑person), mark as delivered immediately and schedule review
    if ((order.salesChannel || 'store') === 'store') {
      try {
        const now = new Date();
        order.status = 'delivered';
        order.deliveredAt = now as any;
        await order.save();

        const initialHours = Number(this.configService.get('REVIEW_REQUEST_INITIAL_HOURS', 6));
        const reminderHours = Number(this.configService.get('REVIEW_REQUEST_REMINDER_HOURS', 24));
        const initialMs = Math.max(0, Math.floor(initialHours * 60 * 60 * 1000));
        const reminderMs = Math.max(0, Math.floor(reminderHours * 60 * 60 * 1000));
        await this.orderModel.findByIdAndUpdate(order._id, {
          reviewRequestScheduledAt: new Date(Date.now() + initialMs),
          reviewReminderScheduledAt: new Date(Date.now() + reminderMs),
        });
      } catch (e) { /* don't block order creation */ }
    }

    if (this.isPaidStatus(paymentStatus)) {
      await this.sendPaymentReceiptAndScheduleReview(
        order,
        email,
        dto.customerPhone || '',
        dto.customerName,
      );
    } else {
      const confirmationSent = await this.whatsAppService.sendOrderConfirmation(
        dto.customerPhone || '',
        this.safeCustomerName(dto.customerName),
        order.orderNumber,
        order.total,
      );
      if (!confirmationSent) {
        this.logWhatsAppFailure('order confirmation', order.orderNumber);
      }
    }

    await this.notificationsService.notifyAdmins(
      'New Order',
      `Order ${order.orderNumber} created from admin panel for ${dto.customerName} - ${total} QAR`,
      'order',
      { orderNumber: order.orderNumber, salesChannel: order.salesChannel || 'store', total },
    ).catch(() => null);

    const adminAlertSent = await this.whatsAppService.sendNewOrderAlert('admin', order.orderNumber, total);
    if (!adminAlertSent) {
      this.logWhatsAppFailure('new order alert', order.orderNumber);
    }

    return { message: 'Order created', order: this.formatOrder(order) };
  }

  async findUserOrders(userId: string, query: { status?: string; page?: number; limit?: number }) {
    const { status, page = 1, limit = 10 } = query;
    const filter: any = { user: new Types.ObjectId(userId) };
    if (status && status !== 'all') filter.status = status;

    const total = await this.orderModel.countDocuments(filter);
    const orders = await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      orders: orders.map((o) => this.formatOrder(o)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findAll(query: { search?: string; status?: string; paymentStatus?: string; paymentMethod?: string; page?: number; limit?: number }) {
    const { search, status, paymentStatus, paymentMethod, page = 1, limit = 10 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: 'i' } },
        { 'customer.name': { $regex: search, $options: 'i' } },
        { 'customer.email': { $regex: search, $options: 'i' } },
      ];
    }
    if (status && status !== 'all') filter.status = status;
    if (paymentStatus && paymentStatus !== 'all') filter.paymentStatus = paymentStatus;
    if (paymentMethod && paymentMethod !== 'all') filter.paymentMethod = paymentMethod;

    const total = await this.orderModel.countDocuments(filter);
    const orders = await this.orderModel
      .find(filter)
      .populate('deliveryStaff', 'fullName phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      orders: orders.map((o) => this.formatOrder(o)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const order = await this.orderModel
      .findById(id)
      .populate('deliveryStaff', 'fullName phone email');
    if (!order) throw new NotFoundException('Order not found');
    return this.formatOrder(order);
  }

  async updateStatus(id: string, dto: UpdateOrderStatusDto, updatedBy = 'admin') {
    const order = await this.orderModel.findById(id).populate('user');
    if (!order) throw new NotFoundException('Order not found');

    const previousStatus = order.status;

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      pending: ['confirmed', 'processing', 'cancelled'],
      confirmed: ['processing', 'cancelled'],
      processing: ['ready', 'shipped', 'cancelled'],
      ready: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    };

    if (!validTransitions[previousStatus]?.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition from ${previousStatus} to ${dto.status}`,
      );
    }

    const update: any = { status: dto.status };
    if (dto.trackingNumber) update.trackingNumber = dto.trackingNumber;
    if (dto.notes) update.notes = dto.notes;

    // Status-specific updates
    if (dto.status === 'delivered') {
      update.deliveredAt = new Date();
    }
    if (dto.status === 'cancelled') {
      if (['cod', 'pending'].includes(order.paymentStatus)) {
        update.paymentStatus = 'refunded';
      }
    }

    const shouldAutoMarkPaidOnDelivery = dto.status === 'delivered'
      && order.paymentMethod === 'cod'
      && ['pending', 'cod'].includes(order.paymentStatus);

    if (shouldAutoMarkPaidOnDelivery) {
      update.paymentStatus = 'paid';
      update.paymentCompletedAt = new Date();
    }

    // Push to status history
    const historyEntries: Array<{ status: string; timestamp: Date; note: string; updatedBy: string }> = [
      {
        status: dto.status,
        timestamp: new Date(),
        note: dto.notes || '',
        updatedBy,
      },
    ];

    if (shouldAutoMarkPaidOnDelivery) {
      historyEntries.push({
        status: 'payment_paid',
        timestamp: new Date(),
        note: 'Payment auto-completed when order marked delivered',
        updatedBy,
      });
    }

    const updatedOrder = await this.orderModel.findOneAndUpdate(
      { _id: id, status: previousStatus },
      {
        $set: update,
        $push: {
          statusHistory: historyEntries.length === 1 ? historyEntries[0] : { $each: historyEntries },
        },
      },
      { returnDocument: 'after' },
    );

    if (!updatedOrder) {
      const latestOrder = await this.orderModel.findById(id).select('status');
      if (!latestOrder) throw new NotFoundException('Order not found');
      throw new ConflictException(`Order status changed from ${previousStatus} to ${latestOrder.status}. Please refresh and try again.`);
    }

    // Get user for notifications
    const user = await this.userModel.findById(order.user);
    const customerPhone = order.customer?.phone || user?.phone || '';
    const customerEmail = order.customer?.email || user?.email || '';
    const customerName = this.safeCustomerName(order.customer?.name || user?.fullName || '');

    if (shouldAutoMarkPaidOnDelivery) {
      await this.sendPaymentReceiptAndScheduleReview(
        updatedOrder,
        customerEmail,
        customerPhone,
        customerName,
      );
    }

    // ─── Automated notifications based on status ───
    const userLanguage = (user as any)?.language || 'en';
    try {
      // Send status update email
      await this.mailService.sendOrderStatusUpdate(
        customerEmail,
        customerName,
        order.orderNumber,
        dto.status,
        userLanguage,
      );
    } catch (e) { /* email failure should not block */ }

    // WhatsApp notifications per status
    switch (dto.status) {
      case 'confirmed':
      case 'processing':
        {
          const statusSent = await this.whatsAppService.sendOrderProcessing(customerPhone, customerName, order.orderNumber);
          if (!statusSent) this.logWhatsAppFailure('processing', order.orderNumber);

          // Send SMS status update
          const smsSent = await this.smsService.sendOrderStatusUpdateSMS(
            customerPhone,
            customerName,
            order,
            dto.status,
          );
          if (!smsSent.success) {
            console.warn('⚠️ SMS status update failed:', smsSent.error);
          }
        }
        break;
      case 'shipped':
        {
          const shippedSent = await this.whatsAppService.sendOrderShipped(
          customerPhone,
          customerName,
          order.orderNumber,
          dto.trackingNumber || order.trackingNumber || '',
        );
          if (!shippedSent) this.logWhatsAppFailure('shipped', order.orderNumber);

          // Send SMS shipped notification
          const smsSent = await this.smsService.sendOrderStatusUpdateSMS(
            customerPhone,
            customerName,
            order,
            'shipped',
          );
          if (!smsSent.success) {
            console.warn('⚠️ SMS shipped notification failed:', smsSent.error);
          }
        }
        break;
      case 'delivered':
        {
          const deliveredSent = await this.whatsAppService.sendOrderDelivered(customerPhone, customerName, order.orderNumber);
          if (!deliveredSent) this.logWhatsAppFailure('delivered', order.orderNumber);

          // Send SMS delivered notification
          const smsSent = await this.smsService.sendOrderStatusUpdateSMS(
            customerPhone,
            customerName,
            order,
            'delivered',
          );
          if (!smsSent.success) {
            console.warn('⚠️ SMS delivered notification failed:', smsSent.error);
          }

          // Ensure deliveredAt is set and schedule review/reminder
          try {
            const now = new Date();
            await this.orderModel.findByIdAndUpdate(order._id, {
              deliveredAt: order.deliveredAt || now,
            });

            // Schedule review and reminder (6h and 24h by default)
            const initialHours = Number(this.configService.get('REVIEW_REQUEST_INITIAL_HOURS', 6));
            const reminderHours = Number(this.configService.get('REVIEW_REQUEST_REMINDER_HOURS', 24));
            const initialMs = Math.max(0, Math.floor(initialHours * 60 * 60 * 1000));
            const reminderMs = Math.max(0, Math.floor(reminderHours * 60 * 60 * 1000));
            await this.orderModel.findByIdAndUpdate(order._id, {
              reviewRequestScheduledAt: new Date(Date.now() + initialMs),
              reviewReminderScheduledAt: new Date(Date.now() + reminderMs),
            });
          } catch (e) { /* scheduling shouldn't block flow */ }
        }

        // Award loyalty points
        if (user) {
          const points = updatedOrder.loyaltyPointsEarned || this.calculateLoyaltyPoints(updatedOrder.total, updatedOrder.loyaltyTierAtOrder || 'silver');
          
          // Use loyalty service to award points and handle tier updates
          await this.loyaltyService.awardPoints(
            user._id.toString(),
            points,
            `Earned from order ${updatedOrder.orderNumber}`,
            updatedOrder._id.toString(),
            updatedOrder.total,
          );

          // Fetch updated user with new tier
          const updatedUser = await this.userModel.findById(user._id);
          if (updatedUser && updatedUser.loyaltyTier !== user.loyaltyTier) {
            // Tier was upgraded, send notification
            await this.whatsAppService.sendLoyaltyUpdate(
              customerPhone,
              customerName,
              updatedUser.loyaltyPoints,
              updatedUser.loyaltyTier || 'silver',
            );
          } else {
            // Send regular points earned notification
            await this.whatsAppService.sendLoyaltyUpdate(
              customerPhone,
              customerName,
              updatedUser?.loyaltyPoints || 0,
              updatedUser?.loyaltyTier || 'silver',
            );
          }

          await this.updateCustomerType(user._id.toString());
        }

        break;

      case 'cancelled':
        {
          const cancelledSent = await this.whatsAppService.sendOrderCancelled(customerPhone, customerName, order.orderNumber);
          if (!cancelledSent) this.logWhatsAppFailure('cancelled', order.orderNumber);
        }
        // Restore stock
        await this.restoreStock(order.items);
        break;
    }

    const adminStatusAlertSent = await this.whatsAppService.sendAdminOrderStatusUpdate(
      'admin',
      order.orderNumber,
      customerName,
      customerPhone,
      dto.status,
    );
    if (!adminStatusAlertSent) {
      this.logWhatsAppFailure('admin status update alert', order.orderNumber);
    }

    // Create admin notification for critical events
    if (['delivered', 'cancelled', 'confirmed'].includes(dto.status)) {
      let title = '';
      let message = '';
      
      if (dto.status === 'delivered') {
        title = `✓ Order Delivered: ${order.orderNumber}`;
        message = `Order from ${customerName} has been successfully delivered. Now waiting for customer reviews.`;
      } else if (dto.status === 'cancelled') {
        title = `✗ Order Cancelled: ${order.orderNumber}`;
        message = `Order from ${customerName} has been cancelled. Purpose: ${dto.notes || 'No reason specified'}`;
      } else if (dto.status === 'confirmed') {
        title = `✓ Order Confirmed: ${order.orderNumber}`;
        message = `Order from ${customerName} (${updatedOrder.items?.length || 0} items, ${updatedOrder.total} QAR) is confirmed and ready for processing.`;
      }

      await this.notificationsService.notifyAdmins(title, message, 'order', {
        orderId: id,
        orderNumber: order.orderNumber,
        status: dto.status,
        customerName,
        total: updatedOrder.total,
        itemCount: updatedOrder.items?.length || 0,
      });
    }

    // Create user notification
    if (user) {
      await this.notificationsService.create({
        user: user._id.toString(),
        title: `Order ${dto.status}`,
        message: `Your order ${order.orderNumber} has been ${dto.status}`,
        type: 'order',
        data: { orderId: id, orderNumber: order.orderNumber, status: dto.status },
      });
    }

    return { message: 'Order status updated', order: this.formatOrder(updatedOrder) };
  }

  async updatePayment(id: string, dto: UpdateOrderPaymentDto, updatedBy = 'admin') {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    const previousPaymentStatus = order.paymentStatus;
    const update: any = {
      paymentStatus: dto.paymentStatus,
    };

    if (dto.paymentMethod) update.paymentMethod = dto.paymentMethod;
    if (dto.paymentId) update.paymentId = dto.paymentId;
    if (dto.paymentStatus === 'paid') update.paymentCompletedAt = new Date();

    // Always add payment_paid to statusHistory if paymentStatus transitions to paid and not already present
    const historyEntry = {
      status: `payment_${dto.paymentStatus}`,
      timestamp: new Date(),
      note: dto.notes || '',
      updatedBy,
    };

    const paymentHistoryEntries: Array<{ status: string; timestamp: Date; note: string; updatedBy: string }> = [historyEntry];
    if (dto.paymentStatus === 'paid') {
      // Check if payment_paid already exists in statusHistory
      const alreadyPaid = order.statusHistory?.some((h: any) => h.status === 'payment_paid');
      if (!alreadyPaid) {
        paymentHistoryEntries.push({
          status: 'payment_paid',
          timestamp: new Date(),
          note: 'Payment confirmed',
          updatedBy,
        });
      }
    }

    const updateQuery: any = {
      $set: update,
      $push: {
        statusHistory: paymentHistoryEntries.length === 1
          ? paymentHistoryEntries[0]
          : { $each: paymentHistoryEntries },
      },
    };

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      id,
      updateQuery,
      { returnDocument: 'after' },
    );

    if (!updatedOrder) throw new NotFoundException('Order not found');

    const user = await this.userModel.findById(order.user);
    const customerPhone = order.customer?.phone || user?.phone || '';
    const customerEmail = order.customer?.email || user?.email || '';
    const customerName = order.customer?.name || user?.fullName || 'Customer';

    if (this.isPaidStatus(dto.paymentStatus) && !this.isPaidStatus(previousPaymentStatus)) {
      await this.sendPaymentReceiptAndScheduleReview(
        updatedOrder,
        customerEmail,
        customerPhone,
        customerName,
      );
    }

    return { message: 'Order payment updated', order: this.formatOrder(updatedOrder) };
  }

  // ─── Assign delivery staff ───
  async assignDelivery(orderId: string, dto: AssignDeliveryDto) {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    // Validate deliveryStaffId to avoid Mongoose CastErrors
    if (!dto?.deliveryStaffId || !Types.ObjectId.isValid(String(dto.deliveryStaffId))) {
      throw new BadRequestException('Invalid delivery staff id');
    }

    const staff = await this.userModel.findOne({
      _id: dto.deliveryStaffId,
      role: 'staff',
    });
    if (!staff) throw new NotFoundException('Delivery staff not found');

    const now = new Date();
    const shouldMoveToOutForDelivery = ['pending', 'confirmed', 'processing', 'ready'].includes(order.status);
    const shouldMarkCodOnAssignment = order.paymentMethod === 'cod' && order.paymentStatus === 'pending';

    const statusHistoryEntries: Array<{ status: string; timestamp: Date; note: string; updatedBy: string }> = [
      {
        status: 'assigned',
        timestamp: now,
        note: `Assigned to ${staff.fullName}`,
        updatedBy: 'admin',
      },
    ];

    if (shouldMoveToOutForDelivery) {
      statusHistoryEntries.push({
        status: 'shipped',
        timestamp: now,
        note: 'Order moved to out for delivery after staff assignment',
        updatedBy: 'system',
      });
    }

    if (shouldMarkCodOnAssignment) {
      statusHistoryEntries.push({
        status: 'payment_cod',
        timestamp: now,
        note: 'COD payment is now due on delivery',
        updatedBy: 'system',
      });
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $set: {
          deliveryStaff: new Types.ObjectId(dto.deliveryStaffId),
          assignedAt: now,
          ...(shouldMoveToOutForDelivery ? { status: 'shipped' } : {}),
          ...(shouldMarkCodOnAssignment ? { paymentStatus: 'cod' } : {}),
        },
        $push: {
          statusHistory: statusHistoryEntries.length === 1 ? statusHistoryEntries[0] : { $each: statusHistoryEntries },
        },
      },
      { returnDocument: 'after' },
    );

    // Notify delivery staff (guard external providers so failures don't return 500)
    try {
      const assignmentSent = await this.whatsAppService.sendDeliveryAssignment(
        staff.phone,
        staff.fullName,
        order.orderNumber,
        order.shippingAddress,
      );
      if (!assignmentSent) this.logWhatsAppFailure('delivery assignment', order.orderNumber);
    } catch (err: any) {
      console.warn('Error sending delivery assignment WhatsApp message', String(err));
    }

    const customerPhone = order.customer?.phone || '';
    if (customerPhone) {
      try {
        const customerAssignmentSent = await this.whatsAppService.sendCustomerCollectionNotice(
          customerPhone,
          this.safeCustomerName(order.customer?.name || ''),
          order.orderNumber,
          staff.fullName,
          staff.phone || 'Support Team',
        );
        if (!customerAssignmentSent) this.logWhatsAppFailure('customer collection notice', order.orderNumber);
      } catch (err: any) {
        console.warn('Error sending customer collection WhatsApp message', String(err));
      }

      if (shouldMoveToOutForDelivery) {
        try {
          const shippedSent = await this.whatsAppService.sendOrderShipped(
            customerPhone,
            this.safeCustomerName(order.customer?.name || ''),
            order.orderNumber,
            order.trackingNumber || '',
            staff.phone || '',
            order.shippingAddress || '',
          );
          if (!shippedSent) this.logWhatsAppFailure('shipped', order.orderNumber);
        } catch (err: any) {
          console.warn('Error sending out-for-delivery WhatsApp message', String(err));
        }
      }
    }

    try {
      await this.notificationsService.create({
        user: dto.deliveryStaffId,
        title: 'New Delivery Assignment',
        message: `Order ${order.orderNumber} has been assigned to you`,
        type: 'delivery',
        data: { orderId, orderNumber: order.orderNumber },
      });
    } catch (err: any) {
      console.warn('Error creating notification for delivery staff', String(err));
    }

    return { message: 'Delivery staff assigned', order: this.formatOrder(updatedOrder!) };
  }

  // ─── Get orders assigned to delivery staff ───
  async getStaffOrders(staffId: string, query: { status?: string; page?: number; limit?: number }) {
    const { status, page = 1, limit = 10 } = query;
    const filter: any = { deliveryStaff: new Types.ObjectId(staffId) };
    if (status && status !== 'all') filter.status = status;

    const total = await this.orderModel.countDocuments(filter);
    const orders = await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      orders: orders.map((o) => this.formatOrder(o)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Submit feedback ───
  async submitFeedback(orderId: string, userId: string, dto: SubmitFeedbackDto) {
    const order = await this.orderModel.findOne({
      _id: orderId,
      user: new Types.ObjectId(userId),
      status: 'delivered',
    });
    if (!order) throw new NotFoundException('Delivered order not found');
    if (order.feedbackRating) throw new BadRequestException('Feedback already submitted');

    await this.orderModel.findByIdAndUpdate(orderId, {
      feedbackRating: dto.rating,
      feedbackComment: dto.comment || '',
    });

    // Notify admin of feedback
    await this.notificationsService.notifyAdmins(
      'New Feedback',
      `Order ${order.orderNumber} received ${dto.rating}/5 rating`,
      'order',
    );

    return { message: 'Feedback submitted' };
  }

  // ─── Submit detailed review ───
  async submitReview(orderId: string, userId: string, dto: any) {
    const order = await this.orderModel.findOne({
      _id: orderId,
      user: new Types.ObjectId(userId),
      status: 'delivered',
    });
    if (!order) throw new NotFoundException('Delivered order not found');

    if (!this.reviewModel) throw new Error('Review model not initialized');

    // Check if review already exists
    const existingReview = await this.reviewModel.findOne({ order: orderId, user: userId });
    if (existingReview) throw new BadRequestException('Review already submitted for this order');

    // Create review
    const review = await this.reviewModel.create({
      user: new Types.ObjectId(userId),
      order: new Types.ObjectId(orderId),
      product: order.items?.[0]?.product || undefined,
      productRating: dto.productRating || 0,
      deliveryRating: dto.deliveryRating || 0,
      productComment: dto.productComment || '',
      deliveryComment: dto.deliveryComment || '',
      images: dto.images || [],
      isVerified: true,
      submittedAt: new Date(),
    });

    // Notify admin of new review  
    await this.notificationsService.notifyAdmins(
      '⭐ New Review Submitted',
      `Order ${order.orderNumber} - Product: ${dto.productRating}/5, Delivery: ${dto.deliveryRating}/5`,
      'review',
      { orderId, reviewId: review._id, productRating: dto.productRating, deliveryRating: dto.deliveryRating },
    );

    // Mark review request as sent
    await this.orderModel.findByIdAndUpdate(orderId, {
      reviewSubmitted: true,
      reviewSubmittedAt: new Date(),
    });

    return { message: 'Review submitted successfully', review };
  }

  // Get pending reviews for admin approval
  async getPendingReviews(query: { page?: number; limit?: number }) {
    const { page = 1, limit = 20 } = query;
    if (!this.reviewModel) throw new Error('Review model not initialized');

    const filter = { isApproved: false };
    const total = await this.reviewModel.countDocuments(filter);
    const reviews = await this.reviewModel
      .find(filter)
      .populate('user', 'fullName email phone avatar')
      .populate('order', 'orderNumber createdAt')
      .populate('product', 'name image')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return { reviews, total, page, totalPages: Math.ceil(total / limit) };
  }

  // Get all reviews with optional status filtering
  async getAllReviews(query: { page?: number; limit?: number; status?: 'pending' | 'approved'; search?: string }) {
    const { page = 1, limit = 20, status, search } = query;
    if (!this.reviewModel) throw new Error('Review model not initialized');

    const filter: any = {};

    // Filter by status
    if (status === 'pending') {
      filter.isApproved = false;
    } else if (status === 'approved') {
      filter.isApproved = true;
    }

    // Search by customer, product, or order number (if needed)
    if (search) {
      // This would require text index or regex search - implement if needed
      // For now, basic filtering is provided
    }

    const total = await this.reviewModel.countDocuments(filter);
    const reviews = await this.reviewModel
      .find(filter)
      .populate('user', 'name email phone')
      .populate('order', 'orderNumber')
      .populate('product', 'name image')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean() // Use lean() for faster queries
      .exec();

    return { reviews, total, page, totalPages: Math.ceil(total / limit) };
  }

  // Approve/reject review
  async approveReview(reviewId: string, isApproved: boolean, reason?: string) {
    if (!this.reviewModel) throw new Error('Review model not initialized');

    const review = await this.reviewModel.findByIdAndUpdate(
      reviewId,
      { isApproved, approvedAt: isApproved ? new Date() : undefined },
      { returnDocument: 'after' },
    );

    if (!review) throw new NotFoundException('Review not found');

    // Notify user about review status
    await this.notificationsService.create({
      user: review.user.toString(),
      title: isApproved ? 'Review Approved' : 'Review Rejected',
      message: isApproved 
        ? 'Your review has been approved and is now visible to other customers' 
        : `Your review was not approved. Reason: ${reason || 'Violates community guidelines'}`,
      type: 'review',
    });

    return { message: isApproved ? 'Review approved' : 'Review rejected', review };
  }

  async getTracking(orderId: string, requester: any) {
    const order = await this.orderModel
      .findById(orderId)
      .populate('deliveryStaff', 'fullName phone email')
      .populate('user', '_id');

    if (!order) throw new NotFoundException('Order not found');

    const requesterRole = requester?.role || 'user';
    const requesterId = String(requester?._id || '');
    const orderUserId = String((order.user as any)?._id || order.user || '');

    if (requesterRole === 'user' && requesterId !== orderUserId) {
      throw new NotFoundException('Order not found');
    }

    return {
      orderNumber: order.orderNumber,
      status: order.status,
      trackingNumber: order.trackingNumber || '',
      shippingAddress: order.shippingAddress,
      assignedAt: order.assignedAt,
      deliveredAt: order.deliveredAt,
      deliveryStaff: (order as any).deliveryStaff
        ? {
            id: (order as any).deliveryStaff._id,
            name: (order as any).deliveryStaff.fullName,
            phone: (order as any).deliveryStaff.phone,
          }
        : null,
      history: (order.statusHistory || []).map((entry: any) => ({
        status: entry.status,
        timestamp: entry.timestamp,
        note: entry.note,
        updatedBy: entry.updatedBy,
      })),
    };
  }

  async sendTrackingReminder(orderId: string, requestedBy = 'system') {
    const order = await this.orderModel.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const user = await this.userModel.findById(order.user);
    const customerPhone = order.customer?.phone || user?.phone || '';
    const customerName = this.safeCustomerName(order.customer?.name || user?.fullName || '');

    if (!customerPhone) {
      throw new BadRequestException('Customer phone number is missing for reminder');
    }

    let sent = false;
    if (order.status === 'shipped') {
      sent = await this.whatsAppService.sendOrderShipped(
        customerPhone,
        customerName,
        order.orderNumber,
        order.trackingNumber || '',
      );
    } else if (order.status === 'delivered') {
      const reviewLink = this.configService.get<string>('GOOGLE_REVIEW_LINK') || '';
      sent = await this.whatsAppService.sendFeedbackRequest(
        customerPhone,
        customerName,
        order.orderNumber,
        reviewLink,
        order._id.toString(),
      );
    } else {
      sent = await this.whatsAppService.sendOrderProcessing(
        customerPhone,
        customerName,
        order.orderNumber,
      );
    }

    await this.orderModel.findByIdAndUpdate(orderId, {
      $push: {
        statusHistory: {
          status: 'reminder_sent',
          timestamp: new Date(),
          note: `Reminder sent by ${requestedBy}`,
          updatedBy: requestedBy,
        },
      },
    });

    if (!sent) {
      this.logWhatsAppFailure('tracking reminder', order.orderNumber);
      return { message: 'Reminder attempted but WhatsApp provider did not confirm delivery', sent: false };
    }

    return { message: 'Reminder sent successfully', sent: true };
  }

  async getStats() {
    const total = await this.orderModel.countDocuments();
    const pending = await this.orderModel.countDocuments({ status: 'pending' });
    const confirmed = await this.orderModel.countDocuments({ status: 'confirmed' });
    const processing = await this.orderModel.countDocuments({ status: 'processing' });
    const delivered = await this.orderModel.countDocuments({ status: 'delivered' });
    const shipped = await this.orderModel.countDocuments({ status: 'shipped' });
    const cancelled = await this.orderModel.countDocuments({ status: 'cancelled' });

    const revenue = await this.orderModel.aggregate([
      { $match: { paymentStatus: { $in: ['paid', 'cod'] }, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);

    const avgRating = await this.orderModel.aggregate([
      { $match: { feedbackRating: { $exists: true, $ne: null } } },
      { $group: { _id: null, avg: { $avg: '$feedbackRating' } } },
    ]);

    return {
      totalOrders: total,
      pendingOrders: pending,
      confirmedOrders: confirmed,
      processingOrders: processing,
      delivered,
      inTransit: shipped,
      cancelled,
      totalRevenue: revenue[0]?.total || 0,
      avgFeedbackRating: avgRating[0]?.avg ? Math.round(avgRating[0].avg * 10) / 10 : null,
    };
  }

  async getRecentOrders(limit = 5) {
    const orders = await this.orderModel
      .find()
      .populate('deliveryStaff', 'fullName phone')
      .sort({ createdAt: -1 })
      .limit(limit);
    return orders.map((o) => this.formatOrder(o));
  }

  async getAuditLogs(query: { action?: string; orderId?: string; page?: number; limit?: number }) {
    const { action, orderId, page = 1, limit = 20 } = query;
    const filter: any = { entityType: 'order' };

    if (action) filter.action = action;
    if (orderId) filter.entityId = new Types.ObjectId(orderId);

    const total = await this.auditLogModel.countDocuments(filter);
    const logs = await this.auditLogModel
      .find(filter)
      .populate('performedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return {
      logs: logs.map((log) => ({
        id: log._id,
        action: log.action,
        entityNumber: log.entityNumber,
        performedBy: log.performedByName,
        performedById: (log as any).performedBy?._id,
        details: log.details,
        ipAddress: log.ipAddress,
        timestamp: log.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getOrderAuditTrail(orderId: string) {
    const logs = await this.auditLogModel
      .find({ entityId: new Types.ObjectId(orderId), entityType: 'order' })
      .populate('performedBy', 'fullName email')
      .sort({ createdAt: -1 })
      .lean();

    return {
      orderId,
      auditTrail: logs.map((log) => ({
        action: log.action,
        performedBy: log.performedByName,
        performedByEmail: (log as any).performedBy?.email,
        details: log.details,
        ipAddress: log.ipAddress,
        timestamp: log.createdAt,
        changes: log.changes,
      })),
    };
  }

  private formatOrder(o: OrderDocument) {
    const deliveryStaff = (o as any).deliveryStaff;
    return {
      id: o._id,
      orderNumber: o.orderNumber,
      customer: o.customer,
      items: o.items,
      subtotal: o.subtotal,
      discount: o.discount,
      shippingCost: o.shippingCost,
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      salesChannel: o.salesChannel,
      paymentId: o.paymentId,
      paymentCompletedAt: o.paymentCompletedAt,
      reviewRequestScheduledAt: o.reviewRequestScheduledAt,
      shippingAddress: o.shippingAddress,
      trackingNumber: o.trackingNumber,
      notes: o.notes,
      discountCode: o.discountCode,
      deliveryStaff: deliveryStaff && typeof deliveryStaff === 'object' && deliveryStaff.fullName
        ? { id: deliveryStaff._id, name: deliveryStaff.fullName, phone: deliveryStaff.phone }
        : deliveryStaff || null,
      assignedAt: o.assignedAt,
      deliveredAt: o.deliveredAt,
      statusHistory: o.statusHistory,
      feedbackRequested: o.feedbackRequested,
      feedbackRating: o.feedbackRating,
      feedbackComment: o.feedbackComment,
      loyaltyPointsEarned: o.loyaltyPointsEarned,
      createdAt: (o as any).createdAt,
      updatedAt: (o as any).updatedAt,
    };
  }
}
