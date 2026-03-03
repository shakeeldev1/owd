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
} from './dto/order.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Cart, CartDocument } from '../cart/schemas/cart.schema';
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
          { new: true },
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
    const isOnlineMethod = ['online', 'visa', 'mastercard', 'apple_pay', 'local_gateway'].includes(paymentMethod);
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
      { new: true },
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
      { new: true },
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
      { new: true },
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
