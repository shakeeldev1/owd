import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { Recipient, RecipientDocument } from './schemas/recipient.schema';
import { UpdateProfileDto, UpdateNotificationsDto } from '../auth/dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Recipient.name) private recipientModel: Model<RecipientDocument>,
  ) {}

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
  async findAll(query: { search?: string; status?: string; role?: string; page?: number; limit?: number }) {
    const { search, status, role, page = 1, limit = 10 } = query;
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
    if (role) filter.role = role;

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

  async toggleStatus(id: string) {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    user.isActive = !user.isActive;
    await user.save();

    return {
      message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
      user,
    };
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

  // Recipients methods
  async getRecipients(userId: string) {
    const recipients = await this.recipientModel.find({ userId }).sort({ isPrimary: -1, createdAt: -1 });
    return { recipients };
  }

  async getRecipientById(userId: string, recipientId: string) {
    const recipient = await this.recipientModel.findOne({ _id: recipientId, userId });
    if (!recipient) throw new NotFoundException('Recipient not found');
    return { data: recipient };
  }

  async createRecipient(userId: string, data: any) {
    // If this is set as primary, unset other primary recipients
    if (data.isPrimary) {
      await this.recipientModel.updateMany({ userId }, { $set: { isPrimary: false } });
    }

    const recipient = await this.recipientModel.create({ userId, ...data });
    return { success: true, data: recipient };
  }

  async updateRecipient(userId: string, recipientId: string, data: any) {
    // If this is set as primary, unset other primary recipients
    if (data.isPrimary) {
      await this.recipientModel.updateMany({ userId, _id: { $ne: recipientId } }, { $set: { isPrimary: false } });
    }

    const recipient = await this.recipientModel.findOneAndUpdate({ _id: recipientId, userId }, { $set: data }, { returnDocument: 'after' });
    if (!recipient) throw new NotFoundException('Recipient not found');
    return { success: true, data: recipient };
  }

  async deleteRecipient(userId: string, recipientId: string) {
    const result = await this.recipientModel.findOneAndDelete({ _id: recipientId, userId });
    if (!result) throw new NotFoundException('Recipient not found');
    return { success: true, message: 'Recipient deleted' };
  }

  async setPrimaryRecipient(userId: string, recipientId: string) {
    // Unset other primary recipients
    await this.recipientModel.updateMany({ userId }, { $set: { isPrimary: false } });

    const recipient = await this.recipientModel.findOneAndUpdate({ _id: recipientId, userId }, { $set: { isPrimary: true } }, { returnDocument: 'after' });
    if (!recipient) throw new NotFoundException('Recipient not found');
    return { success: true, data: recipient };
  }
}
