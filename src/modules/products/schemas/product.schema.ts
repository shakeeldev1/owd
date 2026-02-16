import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  nameAr: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  descriptionAr: string;

  @Prop({ required: true })
  price: number;

  @Prop()
  originalPrice: number;

  @Prop({ default: '' })
  image: string;

  @Prop({ type: [String], default: [] })
  images: string[];

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ required: true })
  sku: string;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  category: Types.ObjectId;

  @Prop({ default: '' })
  categoryName: string;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  reviews: number;

  @Prop({ default: '' })
  badge: string;

  @Prop({ default: '' })
  badgeAr: string;

  @Prop({ default: false })
  isNew: boolean;

  @Prop({ default: false })
  isBestseller: boolean;

  @Prop({ default: false })
  isLimitedEdition: boolean;

  @Prop({ default: false })
  isFeatured: boolean;

  @Prop({ default: 0 })
  stock: number;

  @Prop({ default: 0 })
  sales: number;

  @Prop({ enum: ['active', 'draft', 'archived'], default: 'active' })
  status: string;

  @Prop({ default: 0 })
  weight: number;
}

export const ProductSchema = SchemaFactory.createForClass(Product);

ProductSchema.index({ name: 'text', nameAr: 'text', description: 'text' });
ProductSchema.index({ slug: 1 });
ProductSchema.index({ category: 1 });
ProductSchema.index({ status: 1 });
