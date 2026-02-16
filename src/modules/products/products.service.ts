import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(@InjectModel(Product.name) private productModel: Model<ProductDocument>) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  async create(dto: CreateProductDto) {
    const slug = this.generateSlug(dto.name);
    const existing = await this.productModel.findOne({ slug });
    if (existing) throw new ConflictException('Product with this name already exists');

    // Map isNewArrival to isNew if provided
    const data: any = { ...dto, slug };
    if (dto.isNewArrival !== undefined) {
      data.isNew = dto.isNewArrival;
      delete data.isNewArrival;
    }

    const product = await this.productModel.create(data);
    return { message: 'Product created', product };
  }

  async findAll(query: {
    search?: string;
    category?: string;
    status?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    filter?: string;
    page?: number;
    limit?: number;
    featured?: boolean;
  }) {
    const { search, category, status, minPrice, maxPrice, sort, filter, page = 1, limit = 12, featured } = query;
    const mongoFilter: any = {};

    if (search) {
      mongoFilter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (category && category !== 'all') {
      mongoFilter.categoryName = { $regex: category, $options: 'i' };
    }

    if (status) mongoFilter.status = status;
    else mongoFilter.status = 'active'; // Default to active for public

    if (minPrice !== undefined) mongoFilter.price = { ...mongoFilter.price, $gte: minPrice };
    if (maxPrice !== undefined && maxPrice !== Infinity) mongoFilter.price = { ...mongoFilter.price, $lte: maxPrice };

    if (filter === 'new') mongoFilter.isNew = true;
    if (filter === 'bestseller') mongoFilter.isBestseller = true;
    if (filter === 'limited') mongoFilter.isLimitedEdition = true;

    if (featured) mongoFilter.isFeatured = true;

    let sortOption: any = { createdAt: -1 };
    if (sort === 'price-low') sortOption = { price: 1 };
    if (sort === 'price-high') sortOption = { price: -1 };
    if (sort === 'rating') sortOption = { rating: -1 };
    if (sort === 'newest') sortOption = { createdAt: -1 };
    if (sort === 'featured') sortOption = { isFeatured: -1, createdAt: -1 };

    const total = await this.productModel.countDocuments(mongoFilter);
    const products = await this.productModel
      .find(mongoFilter)
      .sort(sortOption)
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      products: products.map((p) => this.formatProduct(p)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findBySlug(slug: string) {
    const product = await this.productModel.findOne({ slug, status: 'active' });
    if (!product) throw new NotFoundException('Product not found');
    return this.formatProduct(product);
  }

  async findById(id: string) {
    const product = await this.productModel.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    return this.formatProduct(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    const data: any = { ...dto };
    if (dto.name) {
      data.slug = this.generateSlug(dto.name);
    }
    if ((dto as any).isNewArrival !== undefined) {
      data.isNew = (dto as any).isNewArrival;
      delete data.isNewArrival;
    }
    const product = await this.productModel.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!product) throw new NotFoundException('Product not found');
    return { message: 'Product updated', product: this.formatProduct(product) };
  }

  async remove(id: string) {
    const product = await this.productModel.findByIdAndDelete(id);
    if (!product) throw new NotFoundException('Product not found');
    return { message: 'Product deleted' };
  }

  async getStats() {
    const total = await this.productModel.countDocuments();
    const active = await this.productModel.countDocuments({ status: 'active' });
    const outOfStock = await this.productModel.countDocuments({ stock: 0, status: 'active' });
    const draft = await this.productModel.countDocuments({ status: 'draft' });

    return { totalProducts: total, activeProducts: active, outOfStock, draftProducts: draft };
  }

  async getRelated(slug: string, limit = 4) {
    const product = await this.productModel.findOne({ slug });
    if (!product) return [];

    const related = await this.productModel
      .find({
        _id: { $ne: product._id },
        status: 'active',
        $or: [
          { categoryName: product.categoryName },
          { isBestseller: true },
        ],
      })
      .limit(limit);

    return related.map((p) => this.formatProduct(p));
  }

  async getTopProducts(limit = 5) {
    const products = await this.productModel
      .find({ status: 'active' })
      .sort({ sales: -1 })
      .limit(limit);
    return products.map((p) => this.formatProduct(p));
  }

  // Admin: find all including draft/archived
  async adminFindAll(query: { search?: string; status?: string; page?: number; limit?: number }) {
    const { search, status, page = 1, limit = 10 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }
    if (status) filter.status = status;

    const total = await this.productModel.countDocuments(filter);
    const products = await this.productModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      products: products.map((p) => this.formatProduct(p)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  private formatProduct(p: ProductDocument) {
    return {
      id: p._id,
      name: p.name,
      nameAr: p.nameAr,
      description: p.description,
      descriptionAr: p.descriptionAr,
      price: p.price,
      originalPrice: p.originalPrice,
      image: p.image,
      images: p.images,
      slug: p.slug,
      href: `/shop/${p.slug}`,
      sku: p.sku,
      category: p.category,
      categoryName: p.categoryName,
      rating: p.rating,
      reviews: p.reviews,
      badge: p.badge,
      badgeAr: p.badgeAr,
      isNew: p.isNew,
      isBestseller: p.isBestseller,
      isLimitedEdition: p.isLimitedEdition,
      isFeatured: p.isFeatured,
      stock: p.stock,
      sales: p.sales,
      status: p.status,
      weight: p.weight,
      createdAt: (p as any).createdAt,
    };
  }
}
