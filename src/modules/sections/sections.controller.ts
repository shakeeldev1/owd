import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Controller('sections')
export class SectionsController {
  constructor(
    @InjectModel('Section') private sectionModel: Model<any>,
  ) {}

  @Get()
  async findAll() {
    const sections = await this.sectionModel.find({}).sort({ order: 1 });
    return sections;
  }
}
