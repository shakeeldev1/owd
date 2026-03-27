import { ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';

describe('OrdersService reliability guards', () => {
  let service: OrdersService;
  let orderModel: any;
  let reviewModel: any;
  let userModel: any;
  let productModel: any;
  let cartModel: any;
  let settingsModel: any;
  let configService: any;
  let whatsAppService: any;
  let smsService: any;
  let mailService: any;
  let notificationsService: any;

  beforeEach(() => {
    orderModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn(),
      create: jest.fn(),
    };
    reviewModel = {
      create: jest.fn(),
    };
    userModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn(),
    };
    productModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    cartModel = {
      findOneAndUpdate: jest.fn(),
    };
    settingsModel = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
    };
    configService = {
      get: jest.fn().mockReturnValue(''),
    };
    whatsAppService = {
      sendPaymentReceipt: jest.fn().mockResolvedValue(true),
      sendFeedbackRequest: jest.fn().mockResolvedValue(true),
      sendLowStockAlert: jest.fn().mockResolvedValue(true),
      sendOrderConfirmation: jest.fn().mockResolvedValue(true),
      sendNewOrderAlert: jest.fn().mockResolvedValue(true),
      sendOrderProcessing: jest.fn().mockResolvedValue(true),
      sendOrderShipped: jest.fn().mockResolvedValue(true),
      sendOrderDelivered: jest.fn().mockResolvedValue(true),
      sendLoyaltyUpdate: jest.fn().mockResolvedValue(true),
      sendOrderCancelled: jest.fn().mockResolvedValue(true),
      sendDeliveryAssignment: jest.fn().mockResolvedValue(true),
    };
    smsService = {
      sendSMS: jest.fn().mockResolvedValue(true),
      sendOrderConfirmationSMS: jest.fn().mockResolvedValue(true),
      sendOrderStatusUpdateSMS: jest.fn().mockResolvedValue(true),
    };
    mailService = {
      sendPaymentReceipt: jest.fn().mockResolvedValue(undefined),
      sendFeedbackRequest: jest.fn().mockResolvedValue(undefined),
      sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
      sendOrderStatusUpdate: jest.fn().mockResolvedValue(undefined),
      sendLowStockAlert: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      notifyAdmins: jest.fn().mockResolvedValue(undefined),
      create: jest.fn().mockResolvedValue(undefined),
    };

    service = new OrdersService(
      orderModel,
      reviewModel,
      userModel,
      productModel,
      cartModel,
      settingsModel,
      configService,
      whatsAppService,
      smsService,
      mailService,
      notificationsService,
    );
  });

  it('returns the existing order when a paid SkipCash webhook is replayed', async () => {
    const draftToken = Buffer.from(
      JSON.stringify({
        userId: 'user-1',
        orderData: {
          items: [],
          shippingAddress: 'Doha',
          customer: { name: 'Jane' },
        },
      }),
      'utf8',
    ).toString('base64');

    const existingOrder = {
      _id: 'order-1',
      orderNumber: 'ORD-202603-1001',
      paymentId: 'payment-123',
      paymentMethod: 'skipcash',
    };

    orderModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrder);

    const createSpy = jest.spyOn(service, 'create');

    const result = await service.processSkipCashWebhook({
      status: 'paid',
      paymentId: 'payment-123',
      metadata: { draftToken },
    });

    expect(result).toEqual({
      message: 'SkipCash webhook already processed',
      status: 'paid',
      orderId: 'order-1',
      orderNumber: 'ORD-202603-1001',
      paymentId: 'payment-123',
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('throws a conflict when the order status changed before the conditional update completes', async () => {
    const baseOrder = {
      _id: 'order-2',
      user: 'user-2',
      orderNumber: 'ORD-202603-1002',
      customer: {
        name: 'John',
        email: 'john@example.com',
        phone: '5551234',
      },
      items: [],
      subtotal: 10,
      discount: 0,
      shippingCost: 0,
      total: 10,
      status: 'pending',
      paymentStatus: 'pending',
      paymentMethod: 'cod',
      salesChannel: 'website',
      paymentId: '',
      paymentCompletedAt: undefined,
      reviewRequestScheduledAt: undefined,
      shippingAddress: 'Doha',
      trackingNumber: '',
      notes: '',
      discountCode: '',
      deliveryStaff: null,
      assignedAt: undefined,
      deliveredAt: undefined,
      statusHistory: [],
      feedbackRequested: false,
      feedbackRating: undefined,
      feedbackComment: '',
      loyaltyPointsEarned: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    orderModel.findById
      .mockImplementationOnce(() => ({
        populate: jest.fn().mockResolvedValue(baseOrder),
      }))
      .mockImplementationOnce(() => ({
        select: jest.fn().mockResolvedValue({ status: 'processing' }),
      }));
    orderModel.findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.updateStatus('order-2', { status: 'confirmed', notes: 'admin update' }),
    ).rejects.toThrow(new ConflictException('Order status changed from pending to processing. Please refresh and try again.'));

    expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'order-2', status: 'pending' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'confirmed' }),
      }),
      { returnDocument: 'after' },
    );
  });

  it('returns the existing order when SkipCash create hits a duplicate paymentId race', async () => {
    const existingOrder = {
      _id: 'order-3',
      orderNumber: 'ORD-202603-1003',
      customer: { name: 'Jane', email: 'jane@example.com', phone: '5551111' },
      items: [],
      subtotal: 50,
      discount: 0,
      shippingCost: 0,
      total: 50,
      status: 'pending',
      paymentStatus: 'paid',
      paymentMethod: 'skipcash',
      salesChannel: 'website',
      paymentId: 'payment-race',
      paymentCompletedAt: undefined,
      reviewRequestScheduledAt: undefined,
      shippingAddress: 'Doha',
      trackingNumber: '',
      notes: '',
      discountCode: '',
      deliveryStaff: null,
      assignedAt: undefined,
      deliveredAt: undefined,
      statusHistory: [],
      feedbackRequested: false,
      feedbackRating: undefined,
      feedbackComment: '',
      loyaltyPointsEarned: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    userModel.findById.mockResolvedValue({
      _id: 'user-3',
      fullName: 'Jane',
      email: 'jane@example.com',
      phone: '5551111',
    });
    orderModel.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingOrder);
    orderModel.create.mockRejectedValue({
      code: 11000,
      keyPattern: { paymentId: 1 },
      message: 'E11000 duplicate key error collection: orders index: paymentId dup key',
    });

    const result = await service.create('user-3', {
      items: [],
      shippingAddress: 'Doha',
      paymentMethod: 'skipcash',
      paymentId: 'payment-race',
      customer: {
        name: 'Jane',
        email: 'jane@example.com',
        phone: '5551111',
      },
    } as any);

    expect(result).toEqual({
      message: 'Order already exists for this SkipCash payment',
      order: expect.objectContaining({
        orderNumber: 'ORD-202603-1003',
        paymentId: 'payment-race',
        paymentMethod: 'skipcash',
      }),
    });
    expect(orderModel.create).toHaveBeenCalledTimes(1);
  });
});