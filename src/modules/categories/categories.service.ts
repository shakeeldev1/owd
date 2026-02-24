import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(@InjectModel(Category.name) private categoryModel: Model<CategoryDocument>) {}

  private generateSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  async create(dto: CreateCategoryDto) {
    const slug = this.generateSlug(dto.name);
    const existing = await this.categoryModel.findOne({ slug });
    if (existing) throw new ConflictException('Category already exists');

    const category = await this.categoryModel.create({ ...dto, slug });
    return { message: 'Category created', category };
  }

  async findAll(query?: { featured?: boolean }) {
    const filter: any = { isActive: true };
    if (query?.featured) filter.featured = true;

    const categories = await this.categoryModel.find(filter).sort({ name: 1 });
    return categories.map((c) => ({
      _id: c._id,
      id: c._id,
      name: c.name,
      nameAr: c.nameAr,
      description: c.description,
      descriptionAr: c.descriptionAr,
      image: c.image,
      slug: c.slug,
      href: `/shop?category=${c.slug}`,
      productCount: c.productCount,
      featured: c.featured,
    }));
  }

  async findBySlug(slug: string) {
    const category = await this.categoryModel.findOne({ slug, isActive: true });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    if (dto.name) (dto as any).slug = this.generateSlug(dto.name);
    const category = await this.categoryModel.findByIdAndUpdate(id, { $set: dto }, { new: true });
    if (!category) throw new NotFoundException('Category not found');
    return { message: 'Category updated', category };
  }

  async remove(id: string) {
    const category = await this.categoryModel.findByIdAndDelete(id);
    if (!category) throw new NotFoundException('Category not found');
    return { message: 'Category deleted' };
  }

  async updateProductCount(slug: string, count: number) {
    await this.categoryModel.updateOne({ slug }, { productCount: count });
  }
}
