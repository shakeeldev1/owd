import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import mongoose from 'mongoose';
import { SectionsController } from './sections.controller';

const SectionSchema = new mongoose.Schema({}, { strict: false });

@Module({
  imports: [
    MongooseModule.forFeature([{ name: 'Section', schema: SectionSchema, collection: 'sections' }]),
  ],
  controllers: [SectionsController],
})
export class SectionsModule {}
