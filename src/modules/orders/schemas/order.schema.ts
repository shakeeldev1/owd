import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema()
export class OrderItem {
  @Prop({ type: Types.ObjectId, ref: 'Product' })
  product!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ default: '' })
  nameAr!: string;

  @Prop({ required: true })
  price!: number;

  @Prop({ required: true, min: 1 })
  quantity!: number;

  @Prop({ default: '' })
  image!: string;
}

@Schema()
export class StatusHistory {
  @Prop({ required: true })
  status!: string;

  @Prop({ type: Date, default: Date.now })
  timestamp!: Date;

  @Prop({ default: '' })
  note!: string;

  @Prop({ default: '' })
  updatedBy!: string;
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true, unique: true })
  orderNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({
    type: {
      name: String,
      email: String,
      phone: String,
    },
    required: true,
  })
  customer!: {
    name: string;
    email: string;
    phone: string;
  };

  @Prop({ type: [OrderItem], required: true })
  items!: OrderItem[];

  @Prop({ required: true })
  subtotal!: number;

  @Prop({ default: 0 })
  discount!: number;

  @Prop({ default: 0 })
  shippingCost!: number;

  @Prop({ required: true })
  total!: number;

  @Prop({
    enum: ['pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled'],
    default: 'pending',
  })
  status!: string;

  @Prop({
    enum: ['paid', 'pending', 'failed', 'refunded', 'cod'],
    default: 'pending',
  })
  paymentStatus!: string;

  @Prop({
    default: 'cod',
    enum: ['cod', 'skipcash', 'cash', 'card_on_delivery', 'pos_machine', 'online', 'visa', 'mastercard', 'apple_pay', 'bank_transfer', 'local_gateway'],
  })
  paymentMethod!: string;

  @Prop({ enum: ['website', 'delivery', 'store'], default: 'website' })
  salesChannel!: string;

  @Prop({ default: '' })
  paymentId!: string;

  @Prop({ type: Date })
  paymentCompletedAt!: Date;

  @Prop({ type: Date })
  reviewRequestScheduledAt!: Date;

  @Prop({ type: Date })
  reviewReminderScheduledAt!: Date;

  @Prop({ default: '' })
  shippingAddress!: string;

  @Prop({ default: '' })
  trackingNumber!: string;

  @Prop({ default: '' })
  notes!: string;

  @Prop({ default: '' })
  discountCode!: string;

  // Delivery assignment
  @Prop({ type: Types.ObjectId, ref: 'User' })
  deliveryStaff!: Types.ObjectId;

  @Prop({ type: Date })
  assignedAt!: Date;

  @Prop({ type: Date })
  deliveredAt!: Date;

  // Status history for tracking lifecycle
  @Prop({ type: [StatusHistory], default: [] })
  statusHistory!: StatusHistory[];

  // Feedback
  @Prop({ default: false })
  feedbackRequested!: boolean;

  @Prop({ type: Number, min: 1, max: 5 })
  feedbackRating!: number;

  @Prop({ default: '' })
  feedbackComment!: string;

  // Loyalty points earned from this order
  @Prop({ default: 0 })
  loyaltyPointsEarned!: number;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ user: 1 });
OrderSchema.index({ status: 1 });
OrderSchema.index({ deliveryStaff: 1 });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index(
  { paymentMethod: 1, paymentId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentMethod: 'skipcash',
      paymentId: { $type: 'string', $ne: '' },
    },
  },
);
