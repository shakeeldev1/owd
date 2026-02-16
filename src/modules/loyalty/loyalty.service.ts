import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoyaltyTransaction, LoyaltyTransactionDocument } from './schemas/loyalty-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class LoyaltyService {
  constructor(
    @InjectModel(LoyaltyTransaction.name)
    private loyaltyModel: Model<LoyaltyTransactionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // Tier thresholds
  private getTier(lifetimePoints: number): string {
    if (lifetimePoints >= 10000) return 'platinum';
    if (lifetimePoints >= 5000) return 'gold';
    if (lifetimePoints >= 2000) return 'silver';
    return 'bronze';
  }

  // Calculate points earned for an order (1 point per 10 QAR)
  calculatePoints(total: number): number {
    return Math.floor(total / 10);
  }

  // Award points to user
  async awardPoints(
    userId: string,
    points: number,
    description: string,
    orderId?: string,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const newBalance = (user.loyaltyPoints || 0) + points;
    const newLifetime = (user.lifetimePoints || 0) + points;
    const newTier = this.getTier(newLifetime);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newBalance,
      lifetimePoints: newLifetime,
      loyaltyTier: newTier,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'earned',
      points,
      description,
      order: orderId ? new Types.ObjectId(orderId) : undefined,
      balanceAfter: newBalance,
    });

    return { message: 'Points awarded', transaction, newBalance, tier: newTier };
  }

  // Redeem points (100 points = 10 QAR discount)
  async redeemPoints(userId: string, points: number) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if ((user.loyaltyPoints || 0) < points) {
      throw new BadRequestException('Insufficient loyalty points');
    }

    if (points < 100) {
      throw new BadRequestException('Minimum 100 points required for redemption');
    }

    const discountAmount = Math.floor(points / 100) * 10; // 100 points = 10 QAR
    const actualPoints = Math.floor(points / 100) * 100; // Round to nearest 100
    const newBalance = (user.loyaltyPoints || 0) - actualPoints;

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newBalance,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'redeemed',
      points: -actualPoints,
      description: `Redeemed ${actualPoints} points for ${discountAmount} QAR discount`,
      balanceAfter: newBalance,
    });

    return {
      message: 'Points redeemed',
      transaction,
      discountAmount,
      pointsUsed: actualPoints,
      newBalance,
    };
  }

  // Add bonus points (admin action)
  async addBonusPoints(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const newBalance = (user.loyaltyPoints || 0) + points;
    const newLifetime = (user.lifetimePoints || 0) + points;
    const newTier = this.getTier(newLifetime);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newBalance,
      lifetimePoints: newLifetime,
      loyaltyTier: newTier,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'bonus',
      points,
      description: description || 'Bonus points from admin',
      balanceAfter: newBalance,
    });

    return { message: 'Bonus points added', transaction, newBalance, tier: newTier };
  }

  // Adjust points (admin action - can be negative)
  async adjustPoints(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const newBalance = Math.max(0, (user.loyaltyPoints || 0) + points);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newBalance,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'adjustment',
      points,
      description: description || 'Admin adjustment',
      balanceAfter: newBalance,
    });

    return { message: 'Points adjusted', transaction, newBalance };
  }

  // Get user's loyalty info
  async getUserLoyalty(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const nextTier = this.getNextTier(user.loyaltyTier || 'bronze');
    const pointsToNext = this.getPointsToNextTier(user.lifetimePoints || 0);

    return {
      points: user.loyaltyPoints || 0,
      lifetimePoints: user.lifetimePoints || 0,
      tier: user.loyaltyTier || 'bronze',
      nextTier,
      pointsToNextTier: pointsToNext,
      discountValue: Math.floor((user.loyaltyPoints || 0) / 100) * 10,
    };
  }

  // Get transaction history
  async getTransactionHistory(
    userId: string,
    query: { page?: number; limit?: number; type?: string },
  ) {
    const { page = 1, limit = 20, type } = query;
    const filter: any = { user: new Types.ObjectId(userId) };
    if (type) filter.type = type;

    const total = await this.loyaltyModel.countDocuments(filter);
    const transactions = await this.loyaltyModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('order', 'orderNumber total');

    return {
      transactions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Admin: Get loyalty stats
  async getStats() {
    const stats = await this.userModel.aggregate([
      {
        $group: {
          _id: null,
          totalPointsCirculating: { $sum: '$loyaltyPoints' },
          totalLifetimePoints: { $sum: '$lifetimePoints' },
          avgPoints: { $avg: '$loyaltyPoints' },
        },
      },
    ]);

    const tierBreakdown = await this.userModel.aggregate([
      { $group: { _id: '$loyaltyTier', count: { $sum: 1 } } },
    ]);

    const recentRedemptions = await this.loyaltyModel
      .find({ type: 'redeemed' })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('user', 'fullName email');

    return {
      totalPointsCirculating: stats[0]?.totalPointsCirculating || 0,
      totalLifetimePoints: stats[0]?.totalLifetimePoints || 0,
      avgPointsPerUser: Math.round(stats[0]?.avgPoints || 0),
      tierBreakdown: tierBreakdown.reduce(
        (acc, t) => ({ ...acc, [t._id || 'bronze']: t.count }),
        {},
      ),
      recentRedemptions,
    };
  }

  // Admin: Get all users with loyalty info
  async getAllUsersLoyalty(query: { page?: number; limit?: number; tier?: string }) {
    const { page = 1, limit = 20, tier } = query;
    const filter: any = { role: 'user' };
    if (tier) filter.loyaltyTier = tier;

    const total = await this.userModel.countDocuments(filter);
    const users = await this.userModel
      .find(filter)
      .select('fullName email loyaltyPoints lifetimePoints loyaltyTier totalOrders totalSpent')
      .sort({ lifetimePoints: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return { users, total, page, totalPages: Math.ceil(total / limit) };
  }

  private getNextTier(current: string): string | null {
    const tiers = ['bronze', 'silver', 'gold', 'platinum'];
    const idx = tiers.indexOf(current);
    return idx < tiers.length - 1 ? tiers[idx + 1] : null;
  }

  private getPointsToNextTier(lifetimePoints: number): number {
    if (lifetimePoints >= 10000) return 0;
    if (lifetimePoints >= 5000) return 10000 - lifetimePoints;
    if (lifetimePoints >= 2000) return 5000 - lifetimePoints;
    return 2000 - lifetimePoints;
  }
}
