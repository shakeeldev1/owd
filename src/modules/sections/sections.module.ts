import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { SectionsController } from './sections.controller';
import { Product, ProductSchema } from '../products/schemas/product.schema';

const SectionSchema = new mongoose.Schema({}, { strict: false });

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Section', schema: SectionSchema, collection: 'sections' }]),
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
  ],
  controllers: [SectionsController],
})
export class SectionsModule {}
