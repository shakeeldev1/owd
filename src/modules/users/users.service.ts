import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto, UpdateNotificationsDto } from '../auth/dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      address: user.address,
      role: user.role,
      loyaltyTier: user.loyaltyTier,
      totalSpent: user.totalSpent,
      totalOrders: user.totalOrders,
      notifications: user.notifications,
      isVerified: user.isVerified,
      createdAt: (user as any).createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: dto },
      { returnDocument: 'after' },
    );
    if (!user) throw new NotFoundException('User not found');

    return {
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        address: user.address,
        role: user.role,
        loyaltyTier: user.loyaltyTier,
        notifications: user.notifications,
        createdAt: (user as any).createdAt,
      },
    };
  }

  async updateNotifications(userId: string, dto: UpdateNotificationsDto) {
    const updateData: any = {};
    if (dto.orderUpdates !== undefined) updateData['notifications.orderUpdates'] = dto.orderUpdates;
    if (dto.promotions !== undefined) updateData['notifications.promotions'] = dto.promotions;
    if (dto.newsletter !== undefined) updateData['notifications.newsletter'] = dto.newsletter;

    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { returnDocument: 'after' },
    );
    if (!user) throw new NotFoundException('User not found');

    return {
      message: 'Notifications updated',
      notifications: user.notifications,
    };
  }

  // Admin methods
  async findAll(query: { search?: string; status?: string; page?: number; limit?: number }) {
    const { search, status, page = 1, limit = 10 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    if (status === 'active') filter.isActive = true;
    if (status === 'inactive') filter.isActive = false;

    const total = await this.userModel.countDocuments(filter);
    const users = await this.userModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      users: users.map((u) => ({
        id: u._id,
        fullName: u.fullName,
        email: u.email,
        phone: u.phone,
        address: u.address,
        avatar: u.avatar,
        role: u.role,
        isActive: u.isActive,
        isVerified: u.isVerified,
        loyaltyTier: u.loyaltyTier,
        totalSpent: u.totalSpent,
        totalOrders: u.totalOrders,
        createdAt: (u as any).createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async adminUpdateUser(id: string, updateData: any) {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: updateData }, { returnDocument: 'after' });
    if (!user) throw new NotFoundException('User not found');
    return { message: 'User updated', user };
  }

  async deleteUser(id: string) {
    const user = await this.userModel.findByIdAndDelete(id);
    if (!user) throw new NotFoundException('User not found');
    return { message: 'User deleted' };
  }

  async getStats() {
    const total = await this.userModel.countDocuments();
    const active = await this.userModel.countDocuments({ isActive: true });
    const thisMonth = await this.userModel.countDocuments({
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    });

    const avgSpent = await this.userModel.aggregate([
      { $match: { totalOrders: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: { $divide: ['$totalSpent', '$totalOrders'] } } } },
    ]);

    return {
      totalCustomers: total,
      activeCustomers: active,
      newThisMonth: thisMonth,
      avgOrderValue: avgSpent[0]?.avg ? Math.round(avgSpent[0].avg) : 0,
    };
  }
}
