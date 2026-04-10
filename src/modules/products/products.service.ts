import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto, UpdateProductDto, AddProductReviewDto } from './dto/product.dto';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  /**
   * Resolve categoryName from category ObjectId if needed
   * Ensures categoryName is always populated for filtering by category
   */
  private async resolveCategoryName(category?: string, categoryName?: string): Promise<{ category?: string; categoryName?: string }> {
    // If categoryName is already provided, use it as-is
    if (categoryName) {
      return { category, categoryName };
    }

    // If category ObjectId is provided, look up the category name
    if (category && Types.ObjectId.isValid(category)) {
      try {
        const cat = await this.categoryModel.findById(category).select('name').lean();
        if (cat) {
          return { category, categoryName: cat.name };
        } else {
          console.warn(`[ResolveCategoryName] Category ObjectId not found: ${category}`);
        }
      } catch (e) {
        console.warn(`[ResolveCategoryName] Error looking up category: ${e}`);
      }
    }

    // Return the category and categoryName as provided
    // Even if lookup failed, pass the ObjectId through (validation will catch if it's actually invalid)
    return { category, categoryName };
  }

  async create(dto: CreateProductDto) {
    const slug = this.generateSlug(dto.name);
    const existing = await this.productModel.findOne({ slug });
    if (existing) throw new ConflictException('Product with this name already exists');

    // Validate category is provided
    if (!dto.category) {
      throw new ConflictException('Product category is required');
    }

    // Persist the new-arrival flag under a non-reserved schema field.
    const data: any = { ...dto, slug };
    if (dto.isNewArrival !== undefined) {
      data.isNewArrival = dto.isNewArrival;
      delete data.isNewArrival;
    } else if (dto.isNew !== undefined) {
      data.isNewArrival = dto.isNew;
      delete data.isNew;
    }

    // Validate category ObjectId is valid
    if (!Types.ObjectId.isValid(dto.category)) {
      throw new ConflictException(`Invalid category ObjectId: ${dto.category}`);
    }

    // Auto-populate categoryName from category ObjectId if needed
    const { category, categoryName } = await this.resolveCategoryName(dto.category, dto.categoryName);
    data.category = new Types.ObjectId(category);
    data.categoryName = categoryName;

    const product = await this.productModel.create(data);
    console.log(`[ProductCreate] Created product: ${product._id} in category: ${category}`);
    return product;
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

    const parsedPage = Math.max(1, Number(page) || 1);
    const parsedLimit = Math.min(100, Math.max(1, Number(limit) || 12));
    const parsedMinPrice = minPrice === undefined ? undefined : Number(minPrice);
    const parsedMaxPrice = maxPrice === undefined ? undefined : Number(maxPrice);
    const parsedFeatured = typeof featured === 'boolean' ? featured : String(featured).toLowerCase() === 'true';

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

      // Prefer filtering by the stored category ObjectId when possible.
      // This keeps shop results consistent with category product counts.
      let resolvedCategoryId: Types.ObjectId | undefined;

      if (Types.ObjectId.isValid(normalizedCategory)) {
        // Direct ObjectId provided
        resolvedCategoryId = new Types.ObjectId(normalizedCategory);
        console.log(`[ProductFilter] Using direct ObjectId: ${resolvedCategoryId}`);
      } else {
        // Try to resolve slug or name to ObjectId  
        const categoryDoc = await this.categoryModel
          .findOne({
            $or: [
              { slug: normalizedCategory.toLowerCase() },
              { slug: spacedCategory.toLowerCase() },
              { name: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
              { nameAr: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
              // Last resort: case-insensitive partial match on name
              { name: { $regex: normalizedCategory, $options: 'i' } },
            ],
          })
          .select('_id')
          .lean();

        if (categoryDoc?._id) {
          resolvedCategoryId = new Types.ObjectId(String(categoryDoc._id));
          console.log(`[ProductFilter] Resolved "${normalizedCategory}" to ObjectId: ${resolvedCategoryId}`);
        } else {
          console.warn(`[ProductFilter] Could not resolve category: "${normalizedCategory}". Returning all active products.`);
          // FALLBACK: If resolution fails, don't filter by category
          // This is better than returning 0 results
          // Only set filter if we successfully resolved
        }
      }

      // Only filter by resolved category ObjectId if we found it
      if (resolvedCategoryId) {
        mongoFilter.category = resolvedCategoryId;
      } else {
        // If we couldn't resolve the category, DON'T filter
        // Return all products instead of 0 products
        // User will see all products and can try adjusting the filter
        console.log(`[ProductFilter] No category filter applied - returning all products`);
      }
    }

    if (section && section !== 'all') {
      mongoFilter.section = String(section).trim();
    }

    if (status) mongoFilter.status = status;
    else mongoFilter.status = 'active'; // Default to active for public

    if (parsedMinPrice !== undefined && !Number.isNaN(parsedMinPrice)) {
      mongoFilter.price = { ...mongoFilter.price, $gte: parsedMinPrice };
    }
    if (parsedMaxPrice !== undefined && !Number.isNaN(parsedMaxPrice) && parsedMaxPrice !== Infinity) {
      mongoFilter.price = { ...mongoFilter.price, $lte: parsedMaxPrice };
    }

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

    if (filter === 'sale') {
      mongoFilter.$and = [
        ...(mongoFilter.$and || []),
        {
          originalPrice: { $exists: true, $gt: 0 },
        },
        {
          $expr: { $gt: ['$originalPrice', '$price'] },
        },
      ];
    }

    if (parsedFeatured) mongoFilter.isFeatured = true;

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
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit);

    return {
      products: products.map((p) => this.formatPublicProduct(p)),
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
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

    // Handle category updates (only if category is being updated)
    if (dto.category !== undefined) {
      // Validate category ObjectId format
      if (!Types.ObjectId.isValid(dto.category)) {
        throw new ConflictException(`Invalid category ObjectId: ${dto.category}`);
      }

      const { category, categoryName } = await this.resolveCategoryName(dto.category, dto.categoryName);
      data.category = new Types.ObjectId(category);
      if (categoryName) {
        data.categoryName = categoryName;
      } else if (dto.categoryName) {
        data.categoryName = dto.categoryName;
      }
    } else if (dto.categoryName !== undefined) {
      // If only categoryName is provided, try to look up the ObjectId
      try {
        const cat = await this.categoryModel.findOne({ name: dto.categoryName }).select('_id').lean();
        if (cat) {
          data.category = new Types.ObjectId(String(cat._id));
          data.categoryName = dto.categoryName;
        } else {
          console.warn(`[ProductUpdate] Could not find category by name: ${dto.categoryName}`);
        }
      } catch (e) {
        console.warn(`[ProductUpdate] Error looking up category by name: ${e}`);
      }
    }

    const product = await this.productModel.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after' });
    if (!product) throw new NotFoundException('Product not found');
    console.log(`[ProductUpdate] Updated product: ${id}, new category: ${data.category}`);
    return this.formatAdminProduct(product);
  }

  async remove(id: string) {
    const product = await this.productModel.findByIdAndDelete(id);
    if (!product) throw new NotFoundException('Product not found');
  }

  async exportToExcel(res: any) {
    const products = await this.productModel
      .find({ status: 'active' })
      .select('name nameAr sku stock price originalPrice weight unit pricePerTola pricePerPiece lowStockThreshold image images description descriptionAr categoryName rating reviews sales badge badgeAr isNewArrival isBestseller isLimitedEdition isFeatured status')
      .sort({ name: 1 });

    const columnOrder = ['SKU', 'English Name', 'Arabic Name', 'Category', 'Price (QAR)', 'Original Price (QAR)', 'Unit', 'Weight (grams)', 'Price per Tola/Piece (QAR)', 'Stock Available', 'Low Stock Threshold', 'Total Sales', 'Rating', 'Total Reviews', 'Main Image URL', 'All Images (comma separated)', 'English Badge', 'Arabic Badge', 'New Arrival', 'Bestseller', 'Limited Edition', 'Featured', 'Status', 'English Description', 'Arabic Description'];

    const rows: any[][] = [columnOrder]; // Header row
    
    for (const p of products) {
      // Use pricePerPiece for Piece units, pricePerTola for Tola/kg units, otherwise use price
      const unit = (p as any).unit || 'Grams';
      let tierPrice = 0;
      if (unit === 'Piece' && (p as any).pricePerPiece) {
        tierPrice = (p as any).pricePerPiece;
      } else if ((unit === 'Tola' || unit === 'kg') && (p as any).pricePerTola) {
        tierPrice = (p as any).pricePerTola;
      }
      
      const row = [
        String(p.sku || ''),
        String(p.name || ''),
        String(p.nameAr || ''),
        String(p.categoryName || ''),
        Number(p.price) || 0,
        Number((p as any).originalPrice) || 0,
        String(unit),
        Number((p as any).weight) || 0,
        Number(tierPrice) || 0,
        Number(p.stock) || 0,
        Number((p as any).lowStockThreshold) || 10,
        Number((p as any).sales) || 0,
        Number((p as any).rating) || 0,
        Number((p as any).reviews) || 0,
        String((p as any).image || ''),
        String(Array.isArray((p as any).images) ? (p as any).images.join('; ') : ''),
        String((p as any).badge || ''),
        String((p as any).badgeAr || ''),
        ((p as any).isNewArrival ? 'Yes' : 'No'),
        ((p as any).isBestseller ? 'Yes' : 'No'),
        ((p as any).isLimitedEdition ? 'Yes' : 'No'),
        ((p as any).isFeatured ? 'Yes' : 'No'),
        String(p.status || 'active'),
        String((p as any).description || ''),
        String((p as any).descriptionAr || ''),
      ];
      rows.push(row);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    worksheet['!cols'] = [
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
