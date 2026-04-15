import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProductDocument = Product & Document;

@Schema({ _id: false })
export class ProductReview {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ default: '' })
  comment: string;

  @Prop({ default: true })
  verified: boolean;

  @Prop({ default: 0 })
  helpful: number;

  @Prop({ default: Date.now })
  createdAt: Date;
}

const ProductReviewSchema = SchemaFactory.createForClass(ProductReview);

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

  @Prop({ unique: true, sparse: true })
  itemCode: string;

  @Prop({ default: 'Grams', enum: ['Grams', 'Piece', 'Tola', 'Quarter Tola', 'ml', 'kg'] })
  unit: string;

  @Prop({ default: 0 })
  pricePerTola: number;

  @Prop({ default: 0 })
  pricePerQuarterTola: number;

  @Prop({ default: 0 })
  pricePerPiece: number;

  @Prop({ default: 10 })
  lowStockThreshold: number;

  @Prop({ type: Types.ObjectId, ref: 'Category' })
  category: Types.ObjectId;

  @Prop({ default: '' })
  categoryName: string;

  @Prop({ default: '' })
  section: string;

  @Prop({ default: 0 })
  rating: number;

  @Prop({ default: 0 })
  reviews: number;

  @Prop({ type: [ProductReviewSchema], default: [] })
  productReviews: ProductReview[];

  @Prop({ default: '' })
  badge: string;

  @Prop({ default: '' })
  badgeAr: string;

  @Prop({ default: false })
  isNewArrival: boolean;

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
ProductSchema.index({ category: 1 });
ProductSchema.index({ section: 1 });
ProductSchema.index({ status: 1 });
