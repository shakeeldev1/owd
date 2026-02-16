import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoyaltyTransactionDocument = LoyaltyTransaction & Document;

@Schema({ timestamps: true })
export class LoyaltyTransaction {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, enum: ['earned', 'redeemed', 'expired', 'bonus', 'adjustment'] })
  type!: string;

  @Prop({ required: true })
  points!: number;

  @Prop({ default: '' })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  order!: Types.ObjectId;

  @Prop({ default: 0 })
  balanceAfter!: number;
}

export const LoyaltyTransactionSchema = SchemaFactory.createForClass(LoyaltyTransaction);
LoyaltyTransactionSchema.index({ user: 1 });
LoyaltyTransactionSchema.index({ createdAt: -1 });
