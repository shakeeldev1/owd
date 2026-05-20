import { Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { MailService } from '../auth/mail.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { Recipient, RecipientDocument } from './schemas/recipient.schema';
import { UpdateProfileDto, UpdateNotificationsDto } from '../auth/dto';
import { normalizePhone } from '../../utils/phone';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Recipient.name) private recipientModel: Model<RecipientDocument>,
    private mailService: MailService,
    private whatsAppService: WhatsAppService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      country: (user as any).country,
      region: (user as any).region,
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
    const updateData: any = {};

    if (dto.fullName !== undefined) updateData.fullName = dto.fullName;
    else if ((dto as any).name !== undefined) updateData.fullName = (dto as any).name;

    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.avatar !== undefined) updateData.avatar = dto.avatar;
    
    // Normalize phone if being updated
    if (updateData.phone) {
      updateData.phone = normalizePhone(updateData.phone);
    }
    
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateData },
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
        country: (user as any).country,
        region: (user as any).region,
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
    // If admin is updating password, hash it before saving
    if (updateData.password) {
      const hashed = await bcrypt.hash(String(updateData.password), 12);
      updateData.password = hashed;
    }

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

  async createUser(data: any) {
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) throw new BadRequestException('Email is required');
    const existing = await this.userModel.findOne({ email });
    if (existing) throw new ConflictException('Email already registered');

    const phone = String(data.phone || '').trim();
    if (!phone) throw new BadRequestException('Phone is required');

    // Normalize phone if util available
    let normalizedPhone = phone;
    try {
      const { normalizePhone } = require('../../utils/phone');
      normalizedPhone = normalizePhone(phone);
    } catch (e) {
      // fallback to raw
    }

    // If admin provided a password, hash and set it; do NOT generate OTP invitation.
    let passwordHash: string;
    if (data.password) {
      passwordHash = await bcrypt.hash(String(data.password), 12);
    } else {
      // Create with a random (hashed) password so account is not empty and invite via OTP
      const plainPassword = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
      passwordHash = await bcrypt.hash(plainPassword, 12);
    }

    const user = await this.userModel.create({
      fullName: data.name || data.fullName || '',
      email,
      phone: normalizedPhone,
      country: data.country || '',
      region: data.region || '',
      password: passwordHash,
      role: data.role || 'user',
      // If admin provided explicit password, mark verified. Otherwise keep existing behavior (invite via OTP)
      isVerified: !!data.password,
      isActive: data.status !== 'inactive',
    });

    // If no admin password provided, generate a one-time OTP and send a password-reset/invitation email
    if (!data.password) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
      user.otp = otp as any;
      (user as any).otpExpiry = otpExpiry as any;
      await user.save();

      // Send invitation / reset email
      try {
        await this.mailService.sendPasswordResetEmail(user.email, otp, user.fullName || '');
      } catch (e) {
        // swallow email errors but log
        console.error('Failed to send invitation email:', e?.message || e);
      }

      // Also attempt to send invitation via WhatsApp (if phone present)
      try {
        if (normalizedPhone) {
          const inviteMsg = `Hello ${user.fullName || ''}\\nYour account invitation code: ${otp}\\nValid for 10 minutes.`;
          await this.whatsAppService.sendMessage(normalizedPhone, inviteMsg);
        }
      } catch (err: any) {
        console.warn('⚠️ Failed to send invitation WhatsApp:', err?.message || err);
      }
    }

    return {
      message: 'User created. An invitation to set a password has been sent to the user.',
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
      },
    };
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
