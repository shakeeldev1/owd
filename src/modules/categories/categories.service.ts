import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from './schemas/category.schema';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { Product, ProductDocument } from '../products/schemas/product.schema';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
  ) {}

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
    if (typeof query?.featured === 'boolean') {
      filter.featured = query.featured;
    }

    const categories = await this.categoryModel.find(filter).sort({ displayOrder: 1, name: 1 });

    if (!categories.length) return [];

    const categoriesById = new Map<string, CategoryDocument>();

    for (const category of categories) {
      const id = String(category._id);
      categoriesById.set(id, category);
    }

    const productCountsByCategoryId = new Map<string, number>();
    const productImagesByCategoryId = new Map<string, string>();

    const products = await this.productModel
      .find({ status: 'active' })
      .select('_id category categoryName image')
      .lean();

    for (const product of products) {
      let matchedCategory: CategoryDocument | undefined;

      // Only count by ObjectId to match the filtering logic in products.service
      if (product.category) {
        const categoryId = product.category instanceof Types.ObjectId ? product.category.toString() : String(product.category);
        matchedCategory = categoriesById.get(categoryId);
      }

      if (!matchedCategory) continue;

      const key = String(matchedCategory._id);
      productCountsByCategoryId.set(key, (productCountsByCategoryId.get(key) || 0) + 1);

      if (!productImagesByCategoryId.has(key) && product.image) {
        productImagesByCategoryId.set(key, product.image);
      }
    }

    return categories.map((c) => ({
      _id: c._id,
      id: c._id,
      name: c.name,
      nameAr: c.nameAr,
      description: c.description,
      descriptionAr: c.descriptionAr,
      image: productImagesByCategoryId.get(String(c._id)) || c.image || '',
      slug: c.slug,
      href: `/shop?category=${c.slug}`,
      productCount: productCountsByCategoryId.get(String(c._id)) || 0,
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
    const category = await this.categoryModel.findByIdAndUpdate(id, { $set: dto }, { returnDocument: 'after' });
    if (!category) throw new NotFoundException('Category not found');

    // SYNC: Update all products that reference this category
    // When category name/description changes, update the products' denormalized categoryName field
    if (dto.name || dto.nameAr || dto.description || dto.descriptionAr) {
      const productUpdateData: any = {};
      
      // Update categoryName field to match the new category name
      if (dto.name) {
        productUpdateData.categoryName = dto.name;
      }
      
      // Find and update all products with this category
      const categoryObjectId = new Types.ObjectId(id);
      const updatedProducts = await this.productModel.updateMany(
        { category: categoryObjectId },
        { $set: productUpdateData }
      );

      console.log(
        `[CategoryUpdate] Updated category "${category.name}" (ID: ${id}). ` +
        `Synced ${updatedProducts.modifiedCount} products with new categoryName.`
      );
    }

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
