import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User' })
  user!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ enum: ['order', 'delivery', 'loyalty', 'promotion', 'stock', 'system'], default: 'system' })
  type!: string;

  @Prop({ default: false })
  isRead!: boolean;

  @Prop({ type: Object })
  data!: Record<string, any>;

  @Prop({ enum: ['admin', 'staff', 'user', 'all'], default: 'user' })
  targetRole!: string;

  @Prop({ enum: ['en', 'ar'], default: 'en' })
  language!: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ user: 1, isRead: 1 });
NotificationSchema.index({ createdAt: -1 });
