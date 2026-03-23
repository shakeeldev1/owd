import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReviewDocument = Review & Document;

@Schema({ timestamps: true })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  order!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product!: Types.ObjectId;

  @Prop({ required: true, min: 1, max: 5 })
  productRating!: number;

  @Prop({ required: true, min: 1, max: 5 })
  deliveryRating!: number;

  @Prop({ default: '' })
  productComment!: string;

  @Prop({ default: '' })
  deliveryComment!: string;

  @Prop({ type: Boolean, default: false })
  isVerified!: boolean;

  @Prop({ type: Boolean, default: false })
  isApproved!: boolean;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ default: Date.now })
  submittedAt!: Date;

  @Prop({ type: [String], default: [] })
  images?: string[];
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// Add indexes for faster queries
ReviewSchema.index({ user: 1, createdAt: -1 });
ReviewSchema.index({ product: 1, isApproved: 1 });
ReviewSchema.index({ order: 1 });
