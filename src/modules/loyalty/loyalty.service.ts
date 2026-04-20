import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoyaltyTransaction, LoyaltyTransactionDocument } from './schemas/loyalty-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class LoyaltyService {
  // Constants
  private readonly POINT_VALUE = 0.15; // 1 point = 0.15 QAR (5000 points = 750 QAR)
  private readonly SILVER_TIER_RATE = 25; // 1 point per 25 QAR
  private readonly GOLD_TIER_RATE = 20; // 1 point per 20 QAR
  private readonly PLATINUM_TIER_RATE = 15; // 1 point per 15 QAR
  private readonly SILVER_THRESHOLD = 50000; // QAR
  private readonly GOLD_THRESHOLD = 150000; // QAR

  constructor(
    @InjectModel(LoyaltyTransaction.name)
    private loyaltyModel: Model<LoyaltyTransactionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  /**
   * Calculate tier based on total lifetime spending
   * Silver: total_spent < 50,000 QAR
   * Gold: total_spent >= 50,000 QAR
   * Platinum: total_spent >= 150,000 QAR
   */
  private calculateTierFromSpending(totalSpent: number): string {
    if (totalSpent >= this.GOLD_THRESHOLD) return 'platinum';
    if (totalSpent >= this.SILVER_THRESHOLD) return 'gold';
    return 'silver';
  }

  /**
   * Calculate points earned for an order based on tier
   * Silver: 1 point per 25 QAR
   * Gold: 1 point per 20 QAR
   * Platinum: 1 point per 15 QAR
   */
  calculatePointsForOrder(orderAmount: number, tier: string): number {
    let rate = this.SILVER_TIER_RATE;
    if (tier === 'gold') rate = this.GOLD_TIER_RATE;
    if (tier === 'platinum') rate = this.PLATINUM_TIER_RATE;
    return Math.floor(orderAmount / rate);
  }

  /**
   * Convert points to discount value
   * 1 point = 0.15 QAR
   */
  calculateDiscountFromPoints(points: number): number {
    return Math.floor(points * this.POINT_VALUE * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Convert discount value back to points (for deduction)
   * Ensures we only deduct points for the actual discount applied
   */
  calculatePointsFromDiscount(discount: number): number {
    return Math.floor(discount / this.POINT_VALUE);
  }

  /**
   * Award points to user after order completion
   * Updates tier based on new total_spent
   */
  async awardPoints(
    userId: string,
    points: number,
    description: string,
    orderId?: string,
    orderAmount?: number,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Update balances
    const newPointsBalance = (user.loyaltyPoints || 0) + points;
    const newLifetimePoints = (user.lifetimePoints || 0) + points;
    const newTotalSpent = (user.totalSpent || 0) + (orderAmount || 0);
    
    // Recalculate tier based on new total_spent
    const newTier = this.calculateTierFromSpending(newTotalSpent);

    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      {
        loyaltyPoints: newPointsBalance,
        lifetimePoints: newLifetimePoints,
        loyaltyTier: newTier,
        totalSpent: newTotalSpent,
      },
      { new: true },
    );

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'earned',
      points,
      description,
      order: orderId ? new Types.ObjectId(orderId) : undefined,
      balanceAfter: newPointsBalance,
    });

    return {
      message: 'Points awarded',
      transaction,
      newPointsBalance,
      newTier,
      totalSpent: newTotalSpent,
    };
  }

  /**
   * Redeem points for discount at checkout
   * Auto-applies discount without manual user action
   * Returns discount value and points deducted
   */
  async redeemPointsForDiscount(
    userId: string,
    pointsToRedeem: number,
    orderTotal: number,
  ) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if ((user.loyaltyPoints || 0) < pointsToRedeem) {
      throw new BadRequestException('Insufficient loyalty points');
    }

    // Calculate discount from points
    let discountValue = this.calculateDiscountFromPoints(pointsToRedeem);

    // Ensure discount doesn't exceed order total
    if (discountValue > orderTotal) {
      discountValue = orderTotal;
    }

    // Calculate actual points to deduct
    const actualPointsDeducted = this.calculatePointsFromDiscount(discountValue);
    const newPointsBalance = (user.loyaltyPoints || 0) - actualPointsDeducted;

    // Update user
    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newPointsBalance,
    });

    // Create transaction record
    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'redeemed',
      points: -actualPointsDeducted,
      description: `Redeemed ${actualPointsDeducted} points for ${discountValue} QAR discount`,
      balanceAfter: newPointsBalance,
    });

    return {
      message: 'Points redeemed for discount',
      transaction,
      discountAmount: discountValue,
      pointsUsed: actualPointsDeducted,
      newPointsBalance,
    };
  }

  /**
   * Get discount info for given points (preview without deducting)
   * Used for checkout preview/display
   */
  async previewPointsDiscount(userId: string, points: number) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    if ((user.loyaltyPoints || 0) < points) {
      throw new BadRequestException('Insufficient loyalty points');
    }

    const discountValue = this.calculateDiscountFromPoints(points);
    
    return {
      points,
      discountValue,
      message: `${points} points = ${discountValue} QAR discount`,
    };
  }

  /**
   * Add bonus points (admin action)
   */
  async addBonusPoints(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const newPointsBalance = (user.loyaltyPoints || 0) + points;
    const newLifetimePoints = (user.lifetimePoints || 0) + points;
    const newTier = this.calculateTierFromSpending(user.totalSpent || 0);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newPointsBalance,
      lifetimePoints: newLifetimePoints,
      loyaltyTier: newTier,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'bonus',
      points,
      description: description || 'Bonus points from admin',
      balanceAfter: newPointsBalance,
    });

    return { message: 'Bonus points added', transaction, newPointsBalance, tier: newTier };
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

  /**
   * Get user's loyalty info for display
   * Includes tier, points, discount value, and points to next milestone
   */
  async getUserLoyalty(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const currentPoints = user.loyaltyPoints || 0;
    const discountValue = this.calculateDiscountFromPoints(currentPoints);
    
    // Calculate remaining points to next 5000 points milestone
    const pointsModulo = currentPoints % 5000;
    const pointsToNextMilestone = pointsModulo === 0 ? 5000 : 5000 - pointsModulo;

    // Determine next tier based on totalSpent
    const currentTier = user.loyaltyTier || 'silver';
    let nextTier: string | null = null;
    let spentToNextTier = 0;

    if (currentTier === 'silver') {
      nextTier = 'gold';
      spentToNextTier = Math.max(0, this.SILVER_THRESHOLD - (user.totalSpent || 0));
    } else if (currentTier === 'gold') {
      nextTier = 'platinum';
      spentToNextTier = Math.max(0, this.GOLD_THRESHOLD - (user.totalSpent || 0));
    }

    return {
      tier: currentTier,
      points: currentPoints,
      lifetimePoints: user.lifetimePoints || 0,
      totalSpent: user.totalSpent || 0,
      discountValue: Math.round(discountValue * 100) / 100, // Round to 2 decimals
      pointsToNextMilestone,
      nextTier,
      spentToNextTier,
      tierRates: {
        silver: `1 point per ${this.SILVER_TIER_RATE} QAR`,
        gold: `1 point per ${this.GOLD_TIER_RATE} QAR`,
        platinum: `1 point per ${this.PLATINUM_TIER_RATE} QAR`,
      },
      pointValue: this.POINT_VALUE,
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
}
