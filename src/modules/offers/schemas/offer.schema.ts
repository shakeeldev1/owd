import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OfferDocument = Offer & Document;

@Schema({ timestamps: true })
export class Offer {
  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  titleAr!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  descriptionAr!: string;

  @Prop()
  subtitle!: string;

  @Prop()
  subtitleAr!: string;

  @Prop()
  badge!: string;

  @Prop()
  badgeAr!: string;

  @Prop()
  code!: string;

  @Prop({ enum: ['percentage', 'fixed', 'shipping', 'bundle'], default: 'percentage' })
  type!: string;

  @Prop({ default: 0 })
  value!: number;

  @Prop()
  minOrder!: number;

  @Prop()
  maxDiscount!: number;

  @Prop()
  image!: string;

  @Prop()
  gradient!: string;

  @Prop()
  icon!: string;

  @Prop({ type: Date })
  startDate!: Date;

  @Prop({ type: Date })
  endDate!: Date;

  @Prop({ default: 0 })
  usageCount!: number;

  @Prop()
  usageLimit!: number;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ default: false })
  isFeatured!: boolean;

  @Prop({ default: 0 })
  sortOrder!: number;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
