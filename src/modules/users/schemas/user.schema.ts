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

  // Loyalty Tier: Automatically calculated based on total_spent
  // Silver: total_spent < 50,000 QAR
  // Gold: total_spent >= 50,000 QAR
  // Platinum: total_spent >= 150,000 QAR
  @Prop({ default: 'silver', enum: ['silver', 'gold', 'platinum'] })
  loyaltyTier!: string;

  // Current loyalty points balance (can be used for discount)
  @Prop({ default: 0 })
  loyaltyPoints!: number;

  // Lifetime points earned (never decreases, used for tier calculation)
  @Prop({ default: 0 })
  lifetimePoints!: number;

  // Total amount spent by customer (in QAR)
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

  @Prop({ enum: ['en', 'ar'], default: 'en' })
  language!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ role: 1 });
UserSchema.index({ customerType: 1 });
UserSchema.index({ loyaltyTier: 1 });
