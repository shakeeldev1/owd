import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true })
  fullName!: string;

  @Prop({ required: true, unique: true, lowercase: true })
  email!: string;

  @Prop({ required: true })
  phone!: string;

  @Prop({ required: true, select: false })
  password!: string;

  @Prop({ default: '' })
  avatar!: string;

  @Prop({ default: '' })
  address!: string;

  @Prop({ enum: ['user', 'admin', 'staff'], default: 'user' })
  role!: string;

  @Prop({ default: false })
  isVerified!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  otp!: string;

  @Prop()
  otpExpiry!: Date;

  @Prop({ default: 'bronze', enum: ['bronze', 'silver', 'gold', 'platinum'] })
  loyaltyTier!: string;

  @Prop({ default: 0 })
  loyaltyPoints!: number;

  @Prop({ default: 0 })
  lifetimePoints!: number;

  @Prop({ default: 0 })
  totalSpent!: number;

  @Prop({ default: 0 })
  totalOrders!: number;

  // CRM classification
  @Prop({ enum: ['new', 'returning', 'vip', 'inactive'], default: 'new' })
  customerType!: string;

  @Prop({ type: Date })
  lastOrderDate!: Date;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ default: '' })
  notes!: string;

  @Prop({
    type: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      newsletter: { type: Boolean, default: true },
    },
    default: { orderUpdates: true, promotions: false, newsletter: true },
  })
  notifications!: {
    orderUpdates: boolean;
    promotions: boolean;
    newsletter: boolean;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ email: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ customerType: 1 });
UserSchema.index({ loyaltyTier: 1 });
