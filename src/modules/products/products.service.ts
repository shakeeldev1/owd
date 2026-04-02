import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto, UpdateProductDto, AddProductReviewDto } from './dto/product.dto';
import * as XLSX from 'xlsx';

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

    // Persist the new-arrival flag under a non-reserved schema field.
    const data: any = { ...dto, slug };
    if (dto.isNewArrival !== undefined) {
      data.isNewArrival = dto.isNewArrival;
      delete data.isNewArrival;
    } else if (dto.isNew !== undefined) {
      data.isNewArrival = dto.isNew;
      delete data.isNew;
    }

    const product = await this.productModel.create(data);
    return { message: 'Product created', product };
  }

  async findAll(query: {
    search?: string;
    category?: string;
    section?: string;
    status?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    filter?: string;
    page?: number;
    limit?: number;
    featured?: boolean;
  }) {
    const { search, category, section, status, minPrice, maxPrice, sort, filter, page = 1, limit = 12, featured } = query;
    const mongoFilter: any = {};

    if (search) {
      mongoFilter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    if (category && category !== 'all') {
      const normalizedCategory = String(category).trim();
      const spacedCategory = normalizedCategory.replace(/[-_]+/g, ' ');

      mongoFilter.$and = [
        ...(mongoFilter.$and || []),
        {
          $or: [
            { categoryName: { $regex: normalizedCategory, $options: 'i' } },
            { categoryName: { $regex: spacedCategory, $options: 'i' } },
          ],
        },
      ];
    }

    if (section && section !== 'all') {
      mongoFilter.section = section;
    }

    if (status) mongoFilter.status = status;
    else mongoFilter.status = 'active'; // Default to active for public

    if (minPrice !== undefined) mongoFilter.price = { ...mongoFilter.price, $gte: minPrice };
    if (maxPrice !== undefined && maxPrice !== Infinity) mongoFilter.price = { ...mongoFilter.price, $lte: maxPrice };

    if (filter === 'new') {
      mongoFilter.$and = [
        ...(mongoFilter.$and || []),
        {
          $or: [
            { isNewArrival: true },
            { isNew: true },
          ],
        },
      ];
    }
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
      products: products.map((p) => this.formatPublicProduct(p)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findBySlug(slug: string) {
    const product = await this.productModel.findOne({ slug, status: 'active' });
    if (!product) throw new NotFoundException('Product not found');
    return this.formatPublicProduct(product);
  }

  async findById(id: string) {
    const product = await this.productModel.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    return this.formatPublicProduct(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    const data: any = { ...dto };
    if (dto.name) {
      data.slug = this.generateSlug(dto.name);
    }
    if ((dto as any).isNewArrival !== undefined) {
      data.isNewArrival = (dto as any).isNewArrival;
      delete data.isNewArrival;
    } else if ((dto as any).isNew !== undefined) {
      data.isNewArrival = (dto as any).isNew;
      delete data.isNew;
    }
    const product = await this.productModel.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after' });
    if (!product) throw new NotFoundException('Product not found');
    return { message: 'Product updated', product: this.formatAdminProduct(product) };
  }

  async remove(id: string) {
    const product = await this.productModel.findByIdAndDelete(id);
    if (!product) throw new NotFoundException('Product not found');
    return { message: 'Product deleted' };
  }

  async exportToExcel(res: any) {
    const products = await this.productModel
      .find({ status: 'active' })
      .select('name nameAr sku itemCode stock price originalPrice weight unit pricePerTola lowStockThreshold image images description descriptionAr categoryName rating reviews sales badge badgeAr isNewArrival isBestseller isLimitedEdition isFeatured status')
      .sort({ name: 1 });

    const data = products.map((p) => ({
      'Item Code': String((p as any).itemCode || ''),
      'SKU': String(p.sku || ''),
      'English Name': String(p.name || ''),
      'Arabic Name': String(p.nameAr || ''),
      'Category': String(p.categoryName || ''),
      'Price (QAR)': Number(p.price) || 0,
      'Original Price (QAR)': Number((p as any).originalPrice) || 0,
      'Unit': String((p as any).unit || 'Grams'),
      'Weight (grams)': Number((p as any).weight) || 0,
      'Price per Tola/Piece (QAR)': Number((p as any).pricePerTola) || 0,
      'Stock Available': Number(p.stock) || 0,
      'Low Stock Threshold': Number((p as any).lowStockThreshold) || 10,
      'Total Sales': Number((p as any).sales) || 0,
      'Rating': Number((p as any).rating) || 0,
      'Total Reviews': Number((p as any).reviews) || 0,
      'Main Image URL': String((p as any).image || ''),
      'All Images (comma separated)': String(Array.isArray((p as any).images) ? (p as any).images.join('; ') : ''),
      'English Badge': String((p as any).badge || ''),
      'Arabic Badge': String((p as any).badgeAr || ''),
      'New Arrival': ((p as any).isNewArrival ? 'Yes' : 'No'),
      'Bestseller': ((p as any).isBestseller ? 'Yes' : 'No'),
      'Limited Edition': ((p as any).isLimitedEdition ? 'Yes' : 'No'),
      'Featured': ((p as any).isFeatured ? 'Yes' : 'No'),
      'Status': String(p.status || 'active'),
      'English Description': String((p as any).description || ''),
      'Arabic Description': String((p as any).descriptionAr || ''),
    }));

    const columnOrder = ['Item Code', 'SKU', 'English Name', 'Arabic Name', 'Category', 'Price (QAR)', 'Original Price (QAR)', 'Unit', 'Weight (grams)', 'Price per Tola/Piece (QAR)', 'Stock Available', 'Low Stock Threshold', 'Total Sales', 'Rating', 'Total Reviews', 'Main Image URL', 'All Images (comma separated)', 'English Badge', 'Arabic Badge', 'New Arrival', 'Bestseller', 'Limited Edition', 'Featured', 'Status', 'English Description', 'Arabic Description'];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data, { header: columnOrder, cellDates: false });

    worksheet['!cols'] = [
      { wch: 15 },  // Item Code
      { wch: 15 },  // SKU
      { wch: 28 },  // English Name
      { wch: 28 },  // Arabic Name
      { wch: 18 },  // Category
      { wch: 14 },  // Price
      { wch: 16 },  // Original Price
      { wch: 12 },  // Unit
      { wch: 14 },  // Weight
      { wch: 18 },  // Price per Tola
      { wch: 16 },  // Stock
      { wch: 16 },  // Low Stock Threshold
      { wch: 12 },  // Sales
      { wch: 10 },  // Rating
      { wch: 14 },  // Reviews
      { wch: 50 },  // Main Image
      { wch: 60 },  // All Images
      { wch: 18 },  // Badge EN
      { wch: 18 },  // Badge AR
      { wch: 12 },  // New Arrival
      { wch: 12 },  // Bestseller
      { wch: 16 },  // Limited Edition
      { wch: 12 },  // Featured
      { wch: 12 },  // Status
      { wch: 45 },  // English Description
      { wch: 45 },  // Arabic Description
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

    const buffer = Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: false }));
    const date = new Date().toISOString().split('T')[0];
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=products-export-${date}.xlsx`);
    return res.send(buffer);
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

    return related.map((p) => this.formatPublicProduct(p));
  }

  async getTopProducts(limit = 5) {
    const products = await this.productModel
      .find({ status: 'active' })
      .sort({ sales: -1 })
      .limit(limit);
    return products.map((p) => this.formatPublicProduct(p));
  }

  async getTopReviews(limit = 6) {
    const products = await this.productModel
      .find({ status: 'active', 'productReviews.0': { $exists: true } })
      .select('name nameAr slug productReviews')
      .lean();

    const allReviews: any[] = [];
    for (const product of products) {
      const reviews = (product as any).productReviews || [];
      for (const review of reviews) {
        if (review.rating >= 4) {
          allReviews.push({
            userName: review.userName,
            rating: review.rating,
            comment: review.comment,
            productName: product.name,
            productNameAr: (product as any).nameAr,
            productSlug: (product as any).slug,
            createdAt: review.createdAt,
          });
        }
      }
    }

    allReviews.sort((a, b) => b.rating - a.rating || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return allReviews.slice(0, limit);
  }

  async addReview(productId: string, user: any, dto: AddProductReviewDto) {
    if (!dto.rating || dto.rating < 1 || dto.rating > 5) {
      throw new ConflictException('Rating must be between 1 and 5');
    }

    const product = await this.productModel.findById(productId);
    if (!product) throw new NotFoundException('Product not found');

    const existing = (product as any).productReviews?.find(
      (r: any) => String(r.user) === String(user._id),
    );
    if (existing) {
      throw new ConflictException('You have already reviewed this product');
    }

    const review = {
      user: user._id,
      name: user.fullName || 'Customer',
      rating: Math.round(dto.rating),
      comment: dto.comment?.trim() || '',
      verified: true,
      helpful: 0,
      createdAt: new Date(),
    };

    (product as any).productReviews = [...((product as any).productReviews || []), review];

    const totalReviews = (product as any).productReviews.length;
    const totalRating = (product as any).productReviews.reduce((sum: number, r: any) => sum + Number(r.rating || 0), 0);
    product.reviews = totalReviews;
    product.rating = totalReviews > 0 ? Math.round((totalRating / totalReviews) * 10) / 10 : 0;

    await product.save();

    return {
      message: 'Review submitted successfully',
      product: this.formatPublicProduct(product),
    };
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
      products: products.map((p) => this.formatAdminProduct(p)),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Public formatter: hides stock, adds isAvailable ───
  private formatPublicProduct(p: ProductDocument) {
    return {
      _id: p._id,
      id: p._id,
      name: p.name,
      nameAr: p.nameAr,
      description: p.description,
      descriptionAr: p.descriptionAr,
      price: p.price,
      originalPrice: p.originalPrice,
      pricePerTola: (p as any).pricePerTola,
      unit: (p as any).unit,
      image: p.image,
      images: p.images,
      slug: p.slug,
      href: `/shop/${p.slug}`,
      itemCode: (p as any).itemCode,
      category: p.category,
      categoryName: p.categoryName,
      section: (p as any).section,
      rating: p.rating,
      reviews: p.reviews,
      productReviews: ((p as any).productReviews || []).map((review: any, index: number) => ({
        id: index + 1,
        name: review.name,
        rating: review.rating,
        date: review.createdAt,
        comment: review.comment,
        verified: review.verified,
        helpful: review.helpful,
      })),
      badge: p.badge,
      badgeAr: p.badgeAr,
      isNew: (p as any).isNewArrival ?? (p as any).isNew ?? false,
      isNewArrival: (p as any).isNewArrival ?? (p as any).isNew ?? false,
      isBestseller: p.isBestseller,
      isLimitedEdition: p.isLimitedEdition,
      isFeatured: p.isFeatured,
      isAvailable: p.stock > 0,
      sales: p.sales,
      status: p.status,
      weight: p.weight,
      createdAt: (p as any).createdAt,
    };
  }

  // ─── Admin formatter: includes stock, threshold, all fields ───
  private formatAdminProduct(p: ProductDocument) {
    return {
      _id: p._id,
      id: p._id,
      name: p.name,
      nameAr: p.nameAr,
      description: p.description,
      descriptionAr: p.descriptionAr,
      price: p.price,
      originalPrice: p.originalPrice,
      pricePerTola: (p as any).pricePerTola,
      unit: (p as any).unit,
      image: p.image,
      images: p.images,
      slug: p.slug,
      href: `/shop/${p.slug}`,
      sku: p.sku,
      itemCode: (p as any).itemCode,
      category: p.category,
      categoryName: p.categoryName,
      section: (p as any).section,
      rating: p.rating,
      reviews: p.reviews,
      productReviews: (p as any).productReviews || [],
      badge: p.badge,
      badgeAr: p.badgeAr,
      isNew: (p as any).isNewArrival ?? (p as any).isNew ?? false,
      isNewArrival: (p as any).isNewArrival ?? (p as any).isNew ?? false,
      isBestseller: p.isBestseller,
      isLimitedEdition: p.isLimitedEdition,
      isFeatured: p.isFeatured,
      stock: p.stock,
      lowStockThreshold: (p as any).lowStockThreshold,
      isAvailable: p.stock > 0,
      sales: p.sales,
      status: p.status,
      weight: p.weight,
      createdAt: (p as any).createdAt,
    };
  }
}
