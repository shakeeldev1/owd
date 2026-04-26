import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type CartDocument = Cart & Document;

@Schema()
export class CartItem {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  product: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ default: '' })
  nameAr: string;

  @Prop({ required: true })
  price: number;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ default: '' })
  image: string;

  @Prop({ default: '' })
  slug: string;

  @Prop({ default: 'Grams', enum: ['Grams', 'Piece', 'Tola', 'Quarter Tola', 'ml', 'kg'] })
  unit?: string;

  @Prop({ default: 0 })
  pricePerUnit?: number;
}

@Schema({ timestamps: true })
export class Cart {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user: Types.ObjectId;

  @Prop({ type: [CartItem], default: [] })
  items: CartItem[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Product' }], default: [] })
  wishlist: Types.ObjectId[];
}

export const CartSchema = SchemaFactory.createForClass(Cart);
