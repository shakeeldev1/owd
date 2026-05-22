import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../orders/schemas/order.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Contact, ContactDocument } from '../contact/schemas/contact.schema';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Contact.name) private contactModel: Model<ContactDocument>,
  ) {}

  private normalizeLoyaltyTier(tier?: string): 'silver' | 'gold' | 'platinum' {
    const normalized = String(tier || '').trim().toLowerCase();
    if (normalized === 'gold') return 'gold';
    if (normalized === 'platinum') return 'platinum';
    return 'silver';
  }

  async getDashboard(): Promise<any> {
    const [
      totalRevenue,
      totalOrders,
      totalCustomers,
      totalProducts,
      pendingOrders,
      unreadMessages,
      recentOrders,
      topProducts,
      monthlyRevenue,
      ordersByStatus,
    ] = await Promise.all([
      this.getRevenue(),
      this.orderModel.countDocuments(),
      this.userModel.countDocuments({ role: 'user' }),
      this.productModel.countDocuments({ status: 'active' }),
      this.orderModel.countDocuments({ status: 'pending' }),
      this.contactModel.countDocuments({ status: 'new' }),
      this.orderModel
        .find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('user', 'fullName email')
        .exec(),
      this.productModel.find({ status: 'active' }).sort({ sales: -1 }).limit(5).exec(),
      this.getMonthlyRevenue(),
      this.getOrdersByStatus(),
    ]);

    return {
      stats: {
        totalRevenue,
        totalOrders,
        totalCustomers,
        totalProducts,
        pendingOrders,
        unreadMessages,
      },
      recentOrders,
      topProducts,
      monthlyRevenue,
      ordersByStatus,
    };
  }

  private async getRevenue(): Promise<number> {
    const result = await this.orderModel.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    return result[0]?.total || 0;
  }

  private async getMonthlyRevenue(): Promise<any[]> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    return this.orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
          status: { $ne: 'cancelled' },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      {
        $project: {
          _id: 0,
          month: {
            $let: {
              vars: {
                months: ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
              },
              in: { $arrayElemAt: ['$$months', '$_id.month'] },
            },
          },
          revenue: 1,
          orders: 1,
        },
      },
    ]);
  }

  private async getOrdersByStatus(): Promise<any[]> {
    return this.orderModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
    ]);
  }

  async getRevenueByDateRange(startDate: string, endDate: string): Promise<any> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const result = await this.orderModel.aggregate([
      {
        $match: {
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          revenue: { $sum: '$total' },
          orders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', revenue: 1, orders: 1 } },
    ]);

    return result;
  }

  async getCustomerStats(): Promise<any> {
    const [byTier, newThisMonth, topCustomers] = await Promise.all([
      this.userModel.aggregate([
        { $match: { role: 'user' } },
        { $group: { _id: '$loyaltyTier', count: { $sum: 1 } } },
        { $project: { _id: 0, tier: '$_id', count: 1 } },
      ]),
      this.userModel.countDocuments({
        role: 'user',
        createdAt: {
          $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        },
      }),
      this.userModel
        .find({ role: 'user' })
        .sort({ totalSpent: -1 })
        .limit(5)
        .select('fullName email totalSpent totalOrders loyaltyTier')
        .exec(),
    ]);

    const normalizedByTier = byTier.reduce((acc: Record<string, number>, item: any) => {
      const tier = this.normalizeLoyaltyTier(item.tier);
      acc[tier] = (acc[tier] || 0) + item.count;
      return acc;
    }, {});

    return {
      byTier: Object.entries(normalizedByTier).map(([tier, count]) => ({ tier, count })),
      newThisMonth,
      topCustomers: topCustomers.map((customer: any) => ({
        ...customer.toObject(),
        loyaltyTier: this.normalizeLoyaltyTier(customer.loyaltyTier),
      })),
    };
  }
}
