import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoyaltyTransaction, LoyaltyTransactionDocument } from './schemas/loyalty-transaction.schema';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class LoyaltyService {
  // Constants
  private readonly POINTS_PER_BLOCK = 5000;
  private readonly BLOCK_VALUE_QAR = 750;
  private readonly POINT_VALUE = this.BLOCK_VALUE_QAR / this.POINTS_PER_BLOCK; // 1 point = 0.15 QAR (reference only)
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

  private getTierRank(tier: string): number {
    if (tier === 'platinum') return 3;
    if (tier === 'gold') return 2;
    return 1;
  }

  private keepHighestTier(currentTier: string, calculatedTier: string): string {
    return this.getTierRank(currentTier) >= this.getTierRank(calculatedTier)
      ? currentTier
      : calculatedTier;
  }

  private calculateBlockRedemption(
    pointsBalance: number,
    orderTotal?: number,
    requestedPoints?: number,
  ) {
    const safeBalance = Math.max(0, Math.floor(pointsBalance || 0));
    const safeRequestedPoints = Math.max(0, Math.floor(requestedPoints || 0));

    const candidatePoints = safeRequestedPoints > 0
      ? Math.min(safeBalance, Math.floor(safeRequestedPoints / this.POINTS_PER_BLOCK) * this.POINTS_PER_BLOCK)
      : safeBalance;

    const availableBlocks = Math.floor(candidatePoints / this.POINTS_PER_BLOCK);
    const orderBlocks = Number.isFinite(orderTotal)
      ? Math.max(0, Math.floor((orderTotal || 0) / this.BLOCK_VALUE_QAR))
      : Number.MAX_SAFE_INTEGER;

    const redeemableBlocks = Math.max(0, Math.min(availableBlocks, orderBlocks));
    const pointsUsed = redeemableBlocks * this.POINTS_PER_BLOCK;
    const discountValue = redeemableBlocks * this.BLOCK_VALUE_QAR;

    return {
      redeemableBlocks,
      pointsUsed,
      discountValue,
    };
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
   * Rewards are unlocked only in 5000-point blocks
   */
  calculateDiscountFromPoints(points: number): number {
    return this.calculateBlockRedemption(points).discountValue;
  }

  /**
   * Convert discount value back to points (for deduction)
   * Uses full 750 QAR reward blocks only
   */
  calculatePointsFromDiscount(discount: number): number {
    const safeDiscount = Math.max(0, discount || 0);
    const fullBlocks = Math.floor(safeDiscount / this.BLOCK_VALUE_QAR);
    return fullBlocks * this.POINTS_PER_BLOCK;
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

    const pointsToAward = Math.max(0, Math.floor(points || 0));

    // Update balances
    const newPointsBalance = (user.loyaltyPoints || 0) + pointsToAward;
    const newLifetimePoints = (user.lifetimePoints || 0) + pointsToAward;
    const currentTotalSpent = Math.max(0, user.totalSpent || 0);
    
    // Recalculate tier from lifetime spending and keep upgrades permanent.
    const calculatedTier = this.calculateTierFromSpending(currentTotalSpent);
    const newTier = this.keepHighestTier(user.loyaltyTier || 'silver', calculatedTier);

    const updatedUser = await this.userModel.findByIdAndUpdate(
      userId,
      {
        loyaltyPoints: newPointsBalance,
        lifetimePoints: newLifetimePoints,
        loyaltyTier: newTier,
      },
      { new: true },
    );

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'earned',
      points: pointsToAward,
      description,
      order: orderId ? new Types.ObjectId(orderId) : undefined,
      balanceAfter: newPointsBalance,
    });

    return {
      message: 'Points awarded',
      transaction,
      newPointsBalance,
      newTier,
      totalSpent: currentTotalSpent,
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

    const safeOrderTotal = Math.max(0, Number(orderTotal) || 0);
    const currentPoints = Math.max(0, Math.floor(user.loyaltyPoints || 0));

    if (currentPoints < this.POINTS_PER_BLOCK) {
      return {
        message: 'No full loyalty reward block available',
        transaction: null,
        discountAmount: 0,
        pointsUsed: 0,
        redeemableBlocks: 0,
        newPointsBalance: currentPoints,
      };
    }

    const { redeemableBlocks, pointsUsed, discountValue } = this.calculateBlockRedemption(
      currentPoints,
      safeOrderTotal,
      pointsToRedeem,
    );

    if (pointsUsed <= 0 || discountValue <= 0) {
      return {
        message: 'No full loyalty reward block can be applied to this order',
        transaction: null,
        discountAmount: 0,
        pointsUsed: 0,
        redeemableBlocks: 0,
        newPointsBalance: currentPoints,
      };
    }

    const newPointsBalance = currentPoints - pointsUsed;

    // Update user
    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newPointsBalance,
    });

    // Create transaction record
    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'redeemed',
      points: -pointsUsed,
      description: `Redeemed ${pointsUsed} points (${redeemableBlocks} block${redeemableBlocks > 1 ? 's' : ''}) for ${discountValue} QAR discount`,
      balanceAfter: newPointsBalance,
    });

    return {
      message: 'Points redeemed for discount',
      transaction,
      discountAmount: discountValue,
      pointsUsed,
      redeemableBlocks,
      newPointsBalance,
    };
  }

  /**
   * Get discount info for given points (preview without deducting)
   * Used for checkout preview/display
   */
  async previewPointsDiscount(userId: string, points: number, orderTotal?: number) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const currentPoints = Math.max(0, Math.floor(user.loyaltyPoints || 0));
    const requestedPoints = Math.max(0, Math.floor(points || 0));
    const safeOrderTotal = Number.isFinite(orderTotal)
      ? Math.max(0, Number(orderTotal) || 0)
      : undefined;

    const { redeemableBlocks, pointsUsed, discountValue } = this.calculateBlockRedemption(
      currentPoints,
      safeOrderTotal,
      requestedPoints,
    );
    
    return {
      points: pointsUsed,
      discountValue,
      redeemableBlocks,
      message: `${pointsUsed} points (${redeemableBlocks} block${redeemableBlocks > 1 ? 's' : ''}) = ${discountValue} QAR discount`,
    };
  }

  /**
   * Add bonus points (admin action)
   */
  async addBonusPoints(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const safePoints = Math.max(0, Math.floor(points || 0));

    const newPointsBalance = (user.loyaltyPoints || 0) + safePoints;
    const newLifetimePoints = (user.lifetimePoints || 0) + safePoints;
    const calculatedTier = this.calculateTierFromSpending(user.totalSpent || 0);
    const newTier = this.keepHighestTier(user.loyaltyTier || 'silver', calculatedTier);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newPointsBalance,
      lifetimePoints: newLifetimePoints,
      loyaltyTier: newTier,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'bonus',
      points: safePoints,
      description: description || 'Bonus points from admin',
      balanceAfter: newPointsBalance,
    });

    return { message: 'Bonus points added', transaction, newPointsBalance, tier: newTier };
  }

  // Adjust points (admin action - can be negative)
  async adjustPoints(userId: string, points: number, description: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const safePoints = Math.floor(points || 0);

    const newBalance = Math.max(0, (user.loyaltyPoints || 0) + safePoints);

    await this.userModel.findByIdAndUpdate(userId, {
      loyaltyPoints: newBalance,
    });

    const transaction = await this.loyaltyModel.create({
      user: new Types.ObjectId(userId),
      type: 'adjustment',
      points: safePoints,
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

    const currentPoints = Math.max(0, Math.floor(user.loyaltyPoints || 0));
    const redeemableBlocks = Math.floor(currentPoints / this.POINTS_PER_BLOCK);
    const availableReward = redeemableBlocks * this.BLOCK_VALUE_QAR;

    // Keep formula explicit: remaining = 5000 - (points mod 5000)
    const pointsModulo = currentPoints % this.POINTS_PER_BLOCK;
    const pointsToNextMilestone = this.POINTS_PER_BLOCK - pointsModulo;

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
      redeemableBlocks,
      availableReward,
      discountValue: availableReward,
      pointsToNextMilestone,
      nextTier,
      spentToNextTier,
      tierRates: {
        silver: `1 point per ${this.SILVER_TIER_RATE} QAR`,
        gold: `1 point per ${this.GOLD_TIER_RATE} QAR`,
        platinum: `1 point per ${this.PLATINUM_TIER_RATE} QAR`,
      },
      pointValue: this.POINT_VALUE,
      pointsPerRewardBlock: this.POINTS_PER_BLOCK,
      rewardBlockValue: this.BLOCK_VALUE_QAR,
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
        (acc, t) => ({ ...acc, [t._id || 'silver']: t.count }),
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
