import { Controller, Get } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';

@Controller('sections')
export class SectionsController {
  constructor(
    @InjectModel('Section') private sectionModel: Model<any>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

  @Get()
  async findAll() {
    const sections = await this.sectionModel.find({}).sort({ order: 1 }).lean();
    if (!sections.length) return [];

    const slugs = sections
      .map((s: any) => String(s.slug || '').trim())
      .filter(Boolean);

    const counts = await this.productModel
      .aggregate([
        { $match: { status: 'active', section: { $in: slugs } } },
        { $group: { _id: '$section', count: { $sum: 1 } } },
      ]);

    const countsBySlug = new Map<string, number>(
      counts.map((c: any) => [String(c._id), Number(c.count) || 0]),
    );

    return sections.map((s: any) => ({
      ...s,
      productCount: countsBySlug.get(String(s.slug)) || 0,
      href: `/shop?section=${s.slug}`,
    }));
  }
}
