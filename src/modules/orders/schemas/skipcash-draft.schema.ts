import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SkipCashDraftDocument = SkipCashDraft & Document;

// SkipCash's own API only echoes back a short reference string (via TransactionId/Custom1),
// not arbitrary metadata — so the full pending-order details (items, customer, discounts)
// can't be round-tripped through SkipCash itself. We persist them here, keyed by the
// draftReference we generate, and look them up when the webhook reports the payment paid.
@Schema({ timestamps: true })
export class SkipCashDraft {
  @Prop({ required: true, unique: true })
  draftReference!: string;

  @Prop({ required: true })
  userId!: string;

  @Prop({ type: Object, required: true })
  orderData!: Record<string, any>;

  createdAt?: Date;
}

export const SkipCashDraftSchema = SchemaFactory.createForClass(SkipCashDraft);
// Auto-expire abandoned drafts (payment never completed) after 48 hours.
SkipCashDraftSchema.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 60 * 60 });
