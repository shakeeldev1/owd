import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
  ) {}

  async create(data: {
    user?: string;
    title: string;
    message: string;
    type?: string;
    targetRole?: string;
    data?: Record<string, any>;
  }): Promise<NotificationDocument> {
    return this.notificationModel.create({
      user: data.user ? new Types.ObjectId(data.user) : undefined,
      title: data.title,
      message: data.message,
      type: data.type || 'system',
      targetRole: data.targetRole || 'user',
      data: data.data || {},
    });
  }

  async notifyAdmins(title: string, message: string, type = 'system', data: Record<string, any> = {}): Promise<void> {
    await this.notificationModel.create({
      title, message, type, targetRole: 'admin', language: 'ar', data,
    });
  }

  async notifyStaff(title: string, message: string, type = 'system', data: Record<string, any> = {}): Promise<void> {
    await this.notificationModel.create({
      title, message, type, targetRole: 'staff', data,
    });
  }

  async getUserNotifications(userId: string, page = 1, limit = 20) {
    const filter = {
      $or: [
        { user: new Types.ObjectId(userId) },
        { targetRole: 'all' },
      ],
    };
    const total = await this.notificationModel.countDocuments(filter);
    const notifications = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const unreadCount = await this.notificationModel.countDocuments({ ...filter, isRead: false });

    return { notifications, total, unreadCount, page, totalPages: Math.ceil(total / limit) };
  }

  async getAdminNotifications(page = 1, limit = 20) {
    const filter = { $or: [{ targetRole: 'admin' }, { targetRole: 'staff' }, { targetRole: 'all' }] };
    const total = await this.notificationModel.countDocuments(filter);
    const notifications = await this.notificationModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const unreadCount = await this.notificationModel.countDocuments({ ...filter, isRead: false });

    return { notifications, total, unreadCount, page, totalPages: Math.ceil(total / limit) };
  }

  async markAsRead(id: string): Promise<void> {
    await this.notificationModel.findByIdAndUpdate(id, { isRead: true });
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationModel.updateMany(
      { $or: [{ user: new Types.ObjectId(userId) }, { targetRole: 'all' }], isRead: false },
      { isRead: true },
    );
  }

  async markAllAdminAsRead(): Promise<void> {
    await this.notificationModel.updateMany(
      { $or: [{ targetRole: 'admin' }, { targetRole: 'staff' }], isRead: false },
      { isRead: true },
    );
  }

  async delete(id: string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(id);
  }
}
