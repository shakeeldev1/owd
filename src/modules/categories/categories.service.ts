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
    console.log(`[CategoryCreate] Creating category: "${dto.name}" → slug: "${slug}"`);
    
    const existing = await this.categoryModel.findOne({ slug });
    if (existing) {
      console.warn(`[CategoryCreate] Slug already exists: "${slug}" is used by "${existing.name}"`);
      throw new ConflictException(`Category with slug "${slug}" already exists`);
    }

    const categoryData = {
      ...dto,
      slug,
      isActive: true,
      featured: dto.featured ?? false,
      displayOrder: dto.displayOrder ?? 999,
    };

    console.log(`[CategoryCreate] Category data:`, JSON.stringify({
      name: categoryData.name,
      slug: categoryData.slug,
      isActive: categoryData.isActive,
      featured: categoryData.featured,
      displayOrder: categoryData.displayOrder,
    }, null, 2));

    const category = await this.categoryModel.create(categoryData);

    console.log(`[CategoryCreate] ✅ Success: "${category.name}" (ID: ${category._id}, isActive: ${category.isActive})`);
    
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
      isActive: c.isActive,
      displayOrder: c.displayOrder ?? 999,
    }));
  }

  async findBySlug(slug: string) {
    const category = await this.categoryModel.findOne({ slug, isActive: true });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const currentCategory = await this.categoryModel.findById(id);
    if (!currentCategory) throw new NotFoundException('Category not found');

    // Generate new slug if name is being changed
    let newSlug = currentCategory.slug;
    if (dto.name && dto.name !== currentCategory.name) {
      newSlug = this.generateSlug(dto.name);
      console.log(`[CategoryUpdate] Slug change: "${currentCategory.slug}" → "${newSlug}"`);
      
      // Check if the new slug already exists (on a different category)
      const existing = await this.categoryModel.findOne({ 
        slug: newSlug,
        _id: { $ne: new Types.ObjectId(id) } // Exclude current category
      });
      
      if (existing) {
        console.warn(`[CategoryUpdate] ❌ Slug conflict: "${newSlug}" is already used by "${existing.name}"`);
        throw new ConflictException(`Category with slug "${newSlug}" already exists`);
      }
      
      (dto as any).slug = newSlug;
    }

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
        `[CategoryUpdate] ✅ Updated category "${currentCategory.name}" → "${category.name}" (ID: ${id}). ` +
        `Synced ${updatedProducts.modifiedCount} products with new categoryName.`
      );
    }

    return { message: 'Category updated', category };
  }

  async remove(id: string) {
    // Before deleting the category, find all products that reference it
    const categoryToDelete = await this.categoryModel.findById(id);
    if (!categoryToDelete) throw new NotFoundException('Category not found');

    const productsWithCategory = await this.productModel.find({ category: new Types.ObjectId(id) });

    if (productsWithCategory.length > 0) {
      // Find or create the "Other Products" category as fallback
      let otherProductsCategory = await this.categoryModel.findOne({ slug: 'other-products' });
      
      if (!otherProductsCategory) {
        // Create "Other Products" category if it doesn't exist
        otherProductsCategory = await this.categoryModel.create({
          name: 'Other Products',
          nameAr: 'منتجات أخرى',
          description: 'Products without a specific category',
          descriptionAr: 'المنتجات بدون فئة محددة',
          slug: 'other-products',
          image: '',
          featured: false,
          isActive: true,
        });
        console.log('[CategoryDelete] Created "Other Products" category as fallback');
      }

      // Move all products from the deleted category to "Other Products"
      const updatedProducts = await this.productModel.updateMany(
        { category: new Types.ObjectId(id) },
        {
          $set: {
            category: otherProductsCategory._id,
            categoryName: otherProductsCategory.name,
          }
        }
      );

      console.log(
        `[CategoryDelete] Moved ${updatedProducts.modifiedCount} products from "${categoryToDelete.name}" to "Other Products".`
      );
    }

    // Now delete the category
    const category = await this.categoryModel.findByIdAndDelete(id);
    if (!category) throw new NotFoundException('Category not found');

    return { message: 'Category deleted', movedProductsCount: productsWithCategory.length };
  }

  async updateProductCount(slug: string, count: number) {
    await this.categoryModel.updateOne({ slug }, { productCount: count });
  }
}
