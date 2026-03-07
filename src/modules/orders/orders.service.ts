import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from './schemas/order.schema';
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
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MailService } from '../auth/mail.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Cart.name) private cartModel: Model<CartDocument>,
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
    private configService: ConfigService,
    private whatsAppService: WhatsAppService,
    private mailService: MailService,
    private notificationsService: NotificationsService,
  ) {}

  private generateOrderNumber(): string {
    const date = new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${y}${m}-${rand}`;
  }

  // ─── Calculate loyalty points (1 point per 10 QAR) ───
  private calculateLoyaltyPoints(total: number): number {
    return Math.floor(total / 10);
  }

  private isPaidStatus(status: string) {
    return status === 'paid';
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
    const clientIdentifiers = this.getSkipCashClientIdentifiers();
    if (clientIdentifiers.length === 0) {
      throw new BadRequestException('SKIPCASH_KEY_ID or SKIPCASH_CLIENT_ID must be configured');
    }

    const configuredApiUrl = this.configService.get<string>('SKIPCASH_API_URL') || 'https://api.skipcash.app/api/v1/payments';
    const secrets = this.getSkipCashSecrets();
    const payloadCandidates = this.buildSkipCashPayloadCandidates(payload);

    const endpointCandidates = this.buildSkipCashEndpointCandidates(configuredApiUrl);

    let responseBody: any = {};
    let responseStatus = 0;
    let selectedEndpoint = endpointCandidates[0];
    let selectedClientIdentifier = '';
    let ok = false;
    let shouldStopExploring = false;

    const secretCandidates = secrets.length > 0 ? secrets : [''];

    for (const endpoint of endpointCandidates) {
      for (const clientIdentifier of clientIdentifiers) {
        for (const secret of secretCandidates) {
          const headerCandidates: Record<string, string>[] = [
            {
              'content-type': 'application/json',
              'x-client-id': clientIdentifier,
            },
            {
              'content-type': 'application/json',
              'x-key-id': clientIdentifier,
            },
          ];

          for (const headers of headerCandidates) {
            if (secret) {
              headers.authorization = `Bearer ${secret}`;
              headers['x-api-key'] = secret;
              headers['x-client-secret'] = secret;
            }

            for (const payloadVariant of payloadCandidates) {
              selectedEndpoint = endpoint;
              selectedClientIdentifier = clientIdentifier;

              const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(payloadVariant),
              });

              responseStatus = response.status;
              const responseText = await response.text();
              try {
                responseBody = responseText ? JSON.parse(responseText) : {};
              } catch {
                responseBody = { raw: responseText };
              }

              if (response.ok) {
                ok = true;
                break;
              }

              // 404 usually means wrong endpoint path; continue to the next endpoint candidate.
              if (response.status === 404) {
                break;
              }

              // 401/403 can indicate wrong secret; try next secret if available.
              if (response.status === 401 || response.status === 403) {
                break;
              }

              // 400/422 can be payload-shape mismatch; continue trying payload variants.
              if (response.status === 400 || response.status === 422) {
                shouldStopExploring = true;
              }
            }

            if (ok) break;
            if (shouldStopExploring) break;
          }

          if (ok) break;
          if (shouldStopExploring) break;

          if (responseStatus === 404 || responseStatus === 401 || responseStatus === 403) {
            continue;
          }
        }

        if (ok) break;
        if (shouldStopExploring) break;
      }

      if (ok) {
        break;
      }

      if (shouldStopExploring) {
        break;
      }
    }

    if (!ok) {
      const providerMessage = String(
        responseBody?.message
        || responseBody?.error
        || responseBody?.msg
        || responseBody?.detail
        || (Array.isArray(responseBody?.errors) ? responseBody.errors.map((e: any) => String(e?.message || e?.msg || e || '')).filter(Boolean).join('; ') : '')
        || responseBody?.raw
        || '',
      ).trim();

      throw new BadRequestException(
        `SkipCash session creation failed at ${selectedEndpoint} (${responseStatus}) using id ${selectedClientIdentifier || 'n/a'}. ${providerMessage || 'Please verify SKIPCASH_API_URL, FRONTEND_URL return URLs, and SkipCash key id/secret.'}`,
      );
    }

    const checkoutUrl =
      responseBody?.checkoutUrl
      || responseBody?.paymentUrl
      || responseBody?.url
      || responseBody?.redirectUrl
      || responseBody?.data?.checkoutUrl
      || responseBody?.data?.paymentUrl
      || responseBody?.data?.url;

    const paymentId =
      responseBody?.paymentId
      || responseBody?.transactionId
      || responseBody?.id
      || responseBody?.data?.paymentId
      || responseBody?.data?.transactionId
      || responseBody?.data?.id
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
    const shippingCost = subtotal >= 500 ? 0 : 30;
    const total = subtotal + shippingCost;

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
        discountCode: dto.discountCode || '',
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
        name: order.customer?.name || 'Customer',
        email: order.customer?.email || '',
        phone: order.customer?.phone || '',
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
      throw new BadRequestException('Invalid SkipCash webhook key');
    }

    const metadata = this.extractSkipCashMetadata(payload);
    const draftTokenFromMetadata = String(metadata?.draftToken || metadata?.draft_token || '');
    const orderRef = this.extractSkipCashOrderRef(payload);
    if (!orderRef && !draftTokenFromMetadata) {
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

    const existingByPaymentId = paymentId
      ? await this.orderModel.findOne({ paymentId, paymentMethod: 'skipcash' })
      : null;
    if (existingByPaymentId) {
      return {
        message: 'SkipCash webhook already processed',
        status: normalizedStatus,
        orderId: String(existingByPaymentId._id),
        orderNumber: existingByPaymentId.orderNumber,
        paymentId,
      };
    }

    const created = await this.create(draftData.userId, {
      ...draftData.orderData,
      paymentMethod: 'skipcash',
      paymentId,
    });

    return {
      message: 'SkipCash webhook processed and order created',
      status: normalizedStatus,
      paymentId,
      result: created,
    };
  }

  async deleteOrder(id: string) {
    const order = await this.orderModel.findById(id);
    if (!order) throw new NotFoundException('Order not found');

    if (!['cancelled', 'delivered'].includes(order.status)) {
      await this.restoreStock(order.items as any);
    }

    await this.orderModel.findByIdAndDelete(id);
    return { message: 'Order deleted successfully' };
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
      if (product.stock <= 0) {
        throw new BadRequestException(`Product "${product.name}" is out of stock`);
      }
      if (product.stock < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". Available: ${product.stock}, Requested: ${item.quantity}`,
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

    this.whatsAppService.sendPaymentReceipt(
      customerPhone,
      customerName,
      order.orderNumber,
      order.total,
      paymentLabel,
      order.items as any,
    );

    const delayHours = Number(this.configService.get('REVIEW_REQUEST_DELAY_HOURS', 24));
    const delayMs = Math.max(0, Math.floor(delayHours * 60 * 60 * 1000));

    await this.orderModel.findByIdAndUpdate(order._id, {
      reviewRequestScheduledAt: new Date(Date.now() + delayMs),
    });

    setTimeout(async () => {
      try {
        const currentOrder = await this.orderModel.findById(order._id);
        if (!currentOrder || currentOrder.feedbackRequested) return;

        const googleReviewLink = this.configService.get('GOOGLE_REVIEW_LINK') || 'https://g.page/r/alfursan-oud/review';
        await this.mailService.sendFeedbackRequest(
          customerEmail,
          customerName,
          order.orderNumber,
          googleReviewLink,
        );
        this.whatsAppService.sendFeedbackRequest(
          customerPhone,
          customerName,
          order.orderNumber,
          googleReviewLink,
        );
        await this.orderModel.findByIdAndUpdate(order._id, { feedbackRequested: true });
      } catch (e) { }
    }, delayMs);
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
        const product = await this.productModel.findByIdAndUpdate(
          item.product,
          {
            $inc: { stock: -item.quantity, sales: item.quantity },
          },
          { returnDocument: 'after' },
        );

        // Check low stock using per-product threshold
        if (product) {
          const threshold = (product as any).lowStockThreshold || 10;
          if (product.stock <= threshold && product.stock >= 0) {
            const unit = (product as any).unit || 'units';
            const alertMsg = `Product ${product.name} is almost out of stock. Remaining quantity: ${product.stock} ${unit.toLowerCase()}.`;
            await this.notificationsService.notifyAdmins(
              'Low Stock Alert',
              alertMsg,
              'stock',
            );
            this.whatsAppService.sendLowStockAlert('admin', product.name, product.stock);
            // Send email alert
            try {
              await this.mailService.sendLowStockAlert(product.name, product.stock, unit);
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
        await this.productModel.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity, sales: -item.quantity },
        });
      }
    }
  }

  async create(userId: string, dto: CreateOrderDto) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    await this.validateStock(dto.items);

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingCost = subtotal >= 500 ? 0 : 30;
    const total = subtotal + shippingCost;
    const loyaltyPoints = this.calculateLoyaltyPoints(total);

    const paymentMethod = dto.paymentMethod || 'cod';
    const allowedWebsiteMethods = ['cod', 'skipcash'];
    if (!allowedWebsiteMethods.includes(paymentMethod)) {
      throw new BadRequestException('Unsupported payment method for website checkout');
    }

    if (paymentMethod === 'skipcash' && !dto.paymentId) {
      throw new BadRequestException('SkipCash payment must be confirmed before creating the order');
    }

    await this.ensurePaymentMethodEnabled(paymentMethod);
    const isOnlineMethod = ['online', 'visa', 'mastercard', 'apple_pay', 'bank_transfer', 'local_gateway', 'skipcash'].includes(paymentMethod);
    const paymentStatus = isOnlineMethod && dto.paymentId ? 'paid' : 'pending';

    const customerName = dto.customer?.name?.trim() || user.fullName;
    const customerEmail = dto.customer?.email?.trim() || user.email;
    const customerPhone = dto.customer?.phone?.trim() || user.phone || '';

    const order = await this.orderModel.create({
      orderNumber: this.generateOrderNumber(),
      user: new Types.ObjectId(userId),
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
      },
      items: dto.items,
      subtotal,
      shippingCost,
      total,
      shippingAddress: dto.shippingAddress,
      paymentMethod,
      paymentId: dto.paymentId || '',
      paymentStatus,
      salesChannel: dto.salesChannel || 'website',
      discountCode: dto.discountCode || '',
      notes: dto.notes || '',
      loyaltyPointsEarned: loyaltyPoints,
      paymentCompletedAt: this.isPaidStatus(paymentStatus) ? new Date() : undefined,
      statusHistory: [{ status: 'pending', timestamp: new Date(), note: 'Order placed' }],
    });

    // Deduct stock
    await this.deductStock(dto.items);

    // Clear user cart after successful order placement
    await this.cartModel.findOneAndUpdate(
      { user: new Types.ObjectId(userId) },
      { $set: { items: [] } },
    );

    // Update user stats
    await this.userModel.findByIdAndUpdate(userId, {
      $inc: { totalOrders: 1, totalSpent: total },
    });

    // Update customer CRM type
    await this.updateCustomerType(userId);

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

      this.whatsAppService.sendOrderConfirmation(
        customerPhone,
        customerName,
        order.orderNumber,
        order.total,
      );
    }

    // Notify admins
    await this.notificationsService.notifyAdmins(
      'New Order',
      `Order ${order.orderNumber} placed by ${customerName} - ${total} QAR`,
      'order',
    );

    // WhatsApp alert to admin
    this.whatsAppService.sendNewOrderAlert('admin', order.orderNumber, total);

    return { message: 'Order created', order: this.formatOrder(order) };
  }

  async adminCreate(dto: AdminCreateOrderDto) {
    await this.validateStock(dto.items);

    const subtotal = dto.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = subtotal;

    const email = dto.customerEmail?.trim() || `walkin-${Date.now()}@local.customer`;
    let user = await this.userModel.findOne({ email });
    const userId = user?._id || new Types.ObjectId();

    const paymentMethod = dto.paymentMethod || 'cash';
    const paymentStatus = dto.paymentStatus || (['cash', 'pos_machine', 'card_on_delivery'].includes(paymentMethod) ? 'paid' : 'pending');
    const orderStatus = this.isPaidStatus(paymentStatus) ? 'processing' : 'pending';

    const order = await this.orderModel.create({
      orderNumber: this.generateOrderNumber(),
      user: userId,
      customer: {
        name: dto.customerName,
        email,
        phone: dto.customerPhone || '',
      },
      items: dto.items,
      subtotal,
      shippingCost: 0,
      total,
      shippingAddress: dto.shippingAddress,
      paymentMethod,
      paymentStatus,
      status: orderStatus,
      salesChannel: dto.salesChannel || 'store',
      paymentCompletedAt: this.isPaidStatus(paymentStatus) ? new Date() : undefined,
      statusHistory: [
        { status: 'pending', timestamp: new Date(), note: 'Admin created order' },
        { status: orderStatus, timestamp: new Date(), note: 'Admin created order' },
      ],
    });

    // Deduct stock
    await this.deductStock(dto.items);

    if (this.isPaidStatus(paymentStatus)) {
      await this.sendPaymentReceiptAndScheduleReview(
        order,
        email,
        dto.customerPhone || '',
        dto.customerName,
      );
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

    // Push to status history
    const historyEntry = {
      status: dto.status,
      timestamp: new Date(),
      note: dto.notes || '',
      updatedBy,
    };

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      id,
      {
        $set: update,
        $push: { statusHistory: historyEntry },
      },
      { returnDocument: 'after' },
    );

    if (!updatedOrder) throw new NotFoundException('Order not found');

    // Get user for notifications
    const user = await this.userModel.findById(order.user);
    const customerPhone = order.customer?.phone || user?.phone || '';
    const customerEmail = order.customer?.email || user?.email || '';
    const customerName = order.customer?.name || user?.fullName || '';

    // ─── Automated notifications based on status ───
    try {
      // Send status update email
      await this.mailService.sendOrderStatusUpdate(
        customerEmail,
        customerName,
        order.orderNumber,
        dto.status,
      );
    } catch (e) { /* email failure should not block */ }

    // WhatsApp notifications per status
    switch (dto.status) {
      case 'confirmed':
      case 'processing':
        this.whatsAppService.sendOrderProcessing(customerPhone, customerName, order.orderNumber);
        break;
      case 'shipped':
        this.whatsAppService.sendOrderShipped(
          customerPhone,
          customerName,
          order.orderNumber,
          dto.trackingNumber || order.trackingNumber || '',
        );
        break;
      case 'delivered':
        this.whatsAppService.sendOrderDelivered(customerPhone, customerName, order.orderNumber);

        // Award loyalty points
        if (user) {
          const points = updatedOrder.loyaltyPointsEarned || this.calculateLoyaltyPoints(updatedOrder.total);
          await this.userModel.findByIdAndUpdate(user._id, {
            $inc: { loyaltyPoints: points, lifetimePoints: points },
          });

          // Update loyalty tier
          const updatedUser = await this.userModel.findById(user._id);
          if (updatedUser) {
            let newTier = 'bronze';
            if (updatedUser.lifetimePoints >= 10000) newTier = 'platinum';
            else if (updatedUser.lifetimePoints >= 5000) newTier = 'gold';
            else if (updatedUser.lifetimePoints >= 2000) newTier = 'silver';

            if (updatedUser.loyaltyTier !== newTier) {
              await this.userModel.findByIdAndUpdate(user._id, { loyaltyTier: newTier });
              this.whatsAppService.sendLoyaltyUpdate(
                customerPhone,
                customerName,
                updatedUser.loyaltyPoints + points,
                newTier,
              );
            } else {
              this.whatsAppService.sendLoyaltyUpdate(
                customerPhone,
                customerName,
                updatedUser.loyaltyPoints + points,
                updatedUser.loyaltyTier || 'bronze',
              );
            }
          }

          await this.updateCustomerType(user._id.toString());
        }

        break;

      case 'cancelled':
        this.whatsAppService.sendOrderCancelled(customerPhone, customerName, order.orderNumber);
        // Restore stock
        await this.restoreStock(order.items);
        break;
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

    const historyEntry = {
      status: `payment_${dto.paymentStatus}`,
      timestamp: new Date(),
      note: dto.notes || '',
      updatedBy,
    };

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      id,
      {
        $set: update,
        $push: { statusHistory: historyEntry },
      },
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

    const staff = await this.userModel.findOne({
      _id: dto.deliveryStaffId,
      role: 'staff',
    });
    if (!staff) throw new NotFoundException('Delivery staff not found');

    const updatedOrder = await this.orderModel.findByIdAndUpdate(
      orderId,
      {
        $set: {
          deliveryStaff: new Types.ObjectId(dto.deliveryStaffId),
          assignedAt: new Date(),
        },
        $push: {
          statusHistory: {
            status: 'assigned',
            timestamp: new Date(),
            note: `Assigned to ${staff.fullName}`,
            updatedBy: 'admin',
          },
        },
      },
      { returnDocument: 'after' },
    );

    // Notify delivery staff
    this.whatsAppService.sendDeliveryAssignment(
      staff.phone,
      staff.fullName,
      order.orderNumber,
      order.shippingAddress,
    );

    await this.notificationsService.create({
      user: dto.deliveryStaffId,
      title: 'New Delivery Assignment',
      message: `Order ${order.orderNumber} has been assigned to you`,
      type: 'delivery',
      data: { orderId, orderNumber: order.orderNumber },
    });

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
