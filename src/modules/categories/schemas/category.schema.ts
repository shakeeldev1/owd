import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CategoryDocument = Category & Document;

@Schema({ timestamps: true })
export class Category {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  nameAr: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  descriptionAr: string;

  @Prop({ default: '' })
  image: string;

  @Prop({ required: true, unique: true })
  slug: string;

  @Prop({ default: 0 })
  productCount: number;

  @Prop({ default: false })
  featured: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

export const CategorySchema = SchemaFactory.createForClass(Category);
