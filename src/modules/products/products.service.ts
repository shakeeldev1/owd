import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Product, ProductDocument } from './schemas/product.schema';
import { CreateProductDto, UpdateProductDto, AddProductReviewDto } from './dto/product.dto';
import { Category, CategoryDocument } from '../categories/schemas/category.schema';
import * as XLSX from 'xlsx';
import { UNIT_CONVERSION_FACTORS, convertToGrams } from '../../utils/unitConversion';
import { normalizeCategoryName, buildProductUrl } from '../../utils/productCatalog';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    @InjectModel(Category.name) private categoryModel: Model<CategoryDocument>,
    private configService: ConfigService,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private generatePathSegment(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private normalizeOfferFields(data: any): any {
    const next: any = { ...data };
    // If isOnOffer is not provided in the payload, do not modify existing offer fields
    if (next.isOnOffer === undefined || next.isOnOffer === null) {
      return next;
    }

    const isOnOffer = next.isOnOffer === true || next.isOnOffer === 'true';

    // If explicitly not on offer, clear offer-related fields
    if (!isOnOffer) {
      next.isOnOffer = false;
      next.offerPrice = 0;
      next.offerDiscountPercent = 0;
      next.offerStartDate = null;
      next.offerEndDate = null;
      return next;
    }

    const price = Number(next.price || 0);
    const explicitOfferPrice = Number(next.offerPrice);
    const discountPercent = Number(next.offerDiscountPercent);

    let offerPrice = Number.isFinite(explicitOfferPrice) && explicitOfferPrice > 0 ? explicitOfferPrice : NaN;

    if (!Number.isFinite(offerPrice) && Number.isFinite(discountPercent) && discountPercent > 0 && price > 0) {
      offerPrice = Math.round((price * (1 - discountPercent / 100)) * 100) / 100;
    }

    if (!Number.isFinite(offerPrice) || offerPrice <= 0) {
      throw new BadRequestException('Offer price or discount percent is required when a product is on offer');
    }

    if (price > 0 && offerPrice >= price) {
      throw new BadRequestException('Offer price must be lower than the regular price');
    }

    next.offerPrice = Math.round(offerPrice * 100) / 100;

    if (!Number.isFinite(Number(next.offerDiscountPercent)) || Number(next.offerDiscountPercent) <= 0) {
      next.offerDiscountPercent = price > 0 ? Math.round(((price - next.offerPrice) / price) * 100) : 0;
    }

    return next;
  }

  /**
   * Resolve categoryName from category ObjectId if needed
   * Ensures categoryName is always populated for filtering by category
   */
  private async resolveCategoryName(category?: string, categoryName?: string): Promise<{ category?: string; categoryName?: string; categorySlug?: string }> {
    // If categoryName is already provided, use it as-is
    if (categoryName) {
      return { category, categoryName, categorySlug: this.generatePathSegment(categoryName) };
    }

    // If category ObjectId is provided, look up the category name
    if (category && Types.ObjectId.isValid(category)) {
      try {
        const cat = await this.categoryModel.findById(category).select('name slug').lean();
        if (cat) {
          return { category, categoryName: cat.name, categorySlug: this.generatePathSegment((cat as any).slug || cat.name) };
        } else {
          console.warn(`[ResolveCategoryName] Category ObjectId not found: ${category}`);
        }
      } catch (e) {
        console.warn(`[ResolveCategoryName] Error looking up category: ${e}`);
      }
    }

    // Return the category and categoryName as provided
    // Even if lookup failed, pass the ObjectId through (validation will catch if it's actually invalid)
    return { category, categoryName, categorySlug: this.generatePathSegment(categoryName) };
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
    const data: any = this.normalizeOfferFields({ ...dto, slug });
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
    const { category, categoryName, categorySlug } = await this.resolveCategoryName(dto.category, dto.categoryName);
    data.category = new Types.ObjectId(category);
    data.categoryName = categoryName;
    data.categorySlug = categorySlug;

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

      console.log(`[ProductFilter] Filter request: category="${category}" (normalized: "${normalizedCategory}")`);

      // Prefer filtering by the stored category ObjectId when possible.
      // This keeps shop results consistent with category product counts.
      let resolvedCategoryId: Types.ObjectId | undefined;

      if (Types.ObjectId.isValid(normalizedCategory)) {
        // Direct ObjectId provided
        resolvedCategoryId = new Types.ObjectId(normalizedCategory);
        console.log(`[ProductFilter] Using direct ObjectId: ${resolvedCategoryId}`);
      } else {
        // Try to resolve slug or name to ObjectId (only active categories)
        console.log(`[ProductFilter] Attempting to resolve category...`);
        const categoryDoc = await this.categoryModel
          .findOne({
            isActive: true,
            $or: [
              { slug: normalizedCategory.toLowerCase() },
              { slug: spacedCategory.toLowerCase() },
              { name: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
              { nameAr: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
              // Last resort: case-insensitive partial match on name
              { name: { $regex: normalizedCategory, $options: 'i' } },
            ],
          })
          .select('_id name slug isActive')
          .lean();

        if (categoryDoc?._id) {
          resolvedCategoryId = new Types.ObjectId(String(categoryDoc._id));
          console.log(`[ProductFilter] ✅ Resolved "${normalizedCategory}" → "${categoryDoc.name}" (slug: ${categoryDoc.slug}, ID: ${resolvedCategoryId})`);
        } else {
          console.warn(`[ProductFilter] ❌ Could not resolve category: "${normalizedCategory}". Checking what categories exist...`);
          
          // Debug: show all active categories
          const allActive = await this.categoryModel
            .find({ isActive: true })
            .select('name slug')
            .lean();
          console.log(`[ProductFilter] Active categories: ${allActive.map(c => `"${c.name}" (${c.slug})`).join(', ') || 'NONE'}`);
        }
      }

      // Only filter by resolved category ObjectId if we found it
      if (resolvedCategoryId) {
        mongoFilter.category = resolvedCategoryId;
      } else {
        // If we couldn't resolve the category, DON'T filter
        // Return all products instead of 0 products
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
    const data: any = this.normalizeOfferFields({ ...dto });
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

      const { category, categoryName, categorySlug } = await this.resolveCategoryName(dto.category, dto.categoryName);
      data.category = new Types.ObjectId(category);
      if (categoryName) {
        data.categoryName = categoryName;
        data.categorySlug = categorySlug;
      } else if (dto.categoryName) {
        data.categoryName = dto.categoryName;
        data.categorySlug = this.generatePathSegment(dto.categoryName);
      }
    } else if (dto.categoryName !== undefined) {
      // If only categoryName is provided, try to look up the ObjectId
      try {
        const cat = await this.categoryModel.findOne({ name: dto.categoryName }).select('_id name slug').lean();
        if (cat) {
          data.category = new Types.ObjectId(String(cat._id));
          data.categoryName = dto.categoryName;
          data.categorySlug = this.generatePathSegment((cat as any).slug || dto.categoryName);
        } else {
          console.warn(`[ProductUpdate] Could not find category by name: ${dto.categoryName}`);
        }
      } catch (e) {
        console.warn(`[ProductUpdate] Error looking up category by name: ${e}`);
      }
    }

    // If unit is being changed, attempt to convert existing stock/weight to the new unit
    if (dto.unit !== undefined) {
      try {
        const existing = await this.productModel.findById(id).lean();
        if (existing && existing.unit) {
          const oldUnit = String(existing.unit || '').toLowerCase().trim();
          const newUnit = String(dto.unit || '').toLowerCase().trim();
          if (oldUnit && newUnit && oldUnit !== newUnit) {
            const oldStock = Number(existing.stock || 0);
            const grams = convertToGrams(oldStock, oldUnit);
            const newFactor = (UNIT_CONVERSION_FACTORS as any)[newUnit];
            const convertedStock = Number.isFinite(grams) && newFactor ? Math.round((grams / newFactor) * 100) / 100 : grams;
            data.stock = convertedStock;

            const oldWeight = Number(existing.weight || 0);
            const gramsWeight = convertToGrams(oldWeight, oldUnit);
            const convertedWeight = Number.isFinite(gramsWeight) && newFactor ? Math.round((gramsWeight / newFactor) * 100) / 100 : gramsWeight;
            data.weight = convertedWeight;
            console.log(`[ProductUpdate] Converted stock/weight from ${oldUnit} -> ${newUnit}: ${oldStock} -> ${convertedStock}`);
          }
        }
      } catch (e) {
        console.warn(`[ProductUpdate] Failed to convert units: ${e}`);
      }
    }

    const product = await this.productModel.findByIdAndUpdate(id, { $set: data }, { returnDocument: 'after' });
    if (!product) throw new NotFoundException('Product not found');
    return this.formatAdminProduct(product);
  }

  async remove(id: string) {
    const product = await this.productModel.findByIdAndDelete(id);
    if (!product) throw new NotFoundException('Product not found');
  }

  async exportToExcel(res: any) {
    const products = await this.productModel
      .find({ status: 'active' })
      .select('name nameAr sku slug stock price originalPrice weight unit pricePerTola pricePerQuarterTola pricePerPiece lowStockThreshold image images description descriptionAr categoryName categorySlug rating reviews sales badge badgeAr isNewArrival isBestseller isLimitedEdition isFeatured status')
      .sort({ name: 1 });

    const columnOrder = ['Product ID', 'SKU', 'English Name', 'Arabic Name', 'Category', 'Category Slug', 'Price (QAR)', 'Original Price (QAR)', 'Unit', 'Weight (grams)', 'Price per Tola/Quarter Tola/Piece (QAR)', 'Stock Available', 'Low Stock Threshold', 'Total Sales', 'Rating', 'Total Reviews', 'Main Image URL', 'All Images (comma separated)', 'English Badge', 'Arabic Badge', 'New Arrival', 'Bestseller', 'Limited Edition', 'Featured', 'Status', 'Product URL', 'English Description', 'Arabic Description'];

    const rows: any[][] = [columnOrder]; // Header row
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'https://oudalzubarah.com');

    for (const p of products) {
      // Use pricePerPiece for Piece units, pricePerQuarterTola for Quarter Tola, pricePerTola for Tola/kg units, otherwise use price
      const unit = (p as any).unit || 'Grams';
      let tierPrice = 0;
      if (unit === 'Piece' && (p as any).pricePerPiece) {
        tierPrice = (p as any).pricePerPiece;
      } else if (unit === 'Quarter Tola' && (p as any).pricePerQuarterTola) {
        tierPrice = (p as any).pricePerQuarterTola;
      } else if ((unit === 'Tola' || unit === 'kg') && (p as any).pricePerTola) {
        tierPrice = (p as any).pricePerTola;
      }
      
      // Product ID: the same identifier sent as content_ids to Meta Pixel/CAPI, so the
      // catalog feed and ad events always match on the same value.
      const row = [
        String(p.sku || ''),
        String(p.sku || ''),
        String(p.name || ''),
        String(p.nameAr || ''),
        normalizeCategoryName(p.categoryName),
        String((p as any).categorySlug || this.generatePathSegment(p.categoryName)),
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
        buildProductUrl(frontendUrl, p as any),
        String((p as any).description || ''),
        String((p as any).descriptionAr || ''),
      ];
      rows.push(row);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    worksheet['!cols'] = [
      { wch: 15 },  // Product ID
      { wch: 15 },  // SKU
      { wch: 28 },  // English Name
      { wch: 28 },  // Arabic Name
      { wch: 18 },  // Category
      { wch: 18 },  // Category Slug
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
      { wch: 50 },  // Product URL
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

  async generateTemplateExcel(res: any) {
    const columnOrder = ['SKU*', 'English Name*', 'Arabic Name*', 'Category*', 'Category Slug', 'Price (QAR)*', 'Original Price (QAR)', 'Unit*', 'Weight (grams)', 'Price per Tola/Quarter Tola/Piece (QAR)', 'Stock Available*', 'Low Stock Threshold', 'Total Sales', 'Rating', 'Total Reviews', 'Main Image URL', 'All Images (comma separated)', 'English Badge', 'Arabic Badge', 'New Arrival', 'Bestseller', 'Limited Edition', 'Featured', 'Status', 'English Description', 'Arabic Description'];

    const rows: any[][] = [columnOrder]; // Header row only

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    worksheet['!cols'] = [
      { wch: 15 },  // SKU
      { wch: 28 },  // English Name
      { wch: 28 },  // Arabic Name
      { wch: 18 },  // Category
      { wch: 18 },  // Category Slug
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
    res.setHeader('Content-Disposition', `attachment; filename=products-template-${date}.xlsx`);
    return res.send(buffer);
  }

  async importFromExcel(file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    try {
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (rows.length < 2) throw new BadRequestException('File must contain at least a header row and one data row');

      const header = rows[0];
      const errors: any[] = [];
      const created: any[] = [];
      const updated: any[] = [];

      // Map both English and Arabic column names to indices
      const columnMap: Record<string, number> = {};
      header.forEach((col, idx) => {
        if (!col) return;
        const normalized = String(col).toLowerCase().trim().replace(/\*/g, '');
        columnMap[normalized] = idx;
      });

      for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        const rowNum = rowIdx + 1; // Excel row number (1-indexed)

        try {
          // Get values - try to find by normalized column name
          const getSafely = (colName: string) => {
            const normalized = colName.toLowerCase().trim().replace(/\*/g, '');
            const idx = columnMap[normalized];
            return idx !== undefined ? row[idx] : undefined;
          };

          // Required fields validation
          const sku = String(getSafely('SKU') || '').trim();
          const name = String(getSafely('English Name') || '').trim();
          const nameAr = String(getSafely('Arabic Name') || '').trim();
          // Normalize known category-name variants (e.g. "GIFT BOXS", "AL OUD") to their
          // canonical form so re-imports don't keep reintroducing duplicate categories.
          const categoryName = normalizeCategoryName(String(getSafely('Category') || '').trim());
          const priceStr = String(getSafely('Price (QAR)') || '0').trim();
          const unitStr = String(getSafely('Unit') || 'Grams').trim();
          const stockStr = String(getSafely('Stock Available') || '0').trim();
          // Validation
          if (!sku) throw new BadRequestException('SKU is required');
          if (!name) throw new BadRequestException('English Name is required');
          if (!nameAr) throw new BadRequestException('Arabic Name is required');
          if (!categoryName) throw new BadRequestException('Category is required');

          const price = Number(priceStr);
          if (isNaN(price) || price < 0) throw new BadRequestException('Price must be a valid number >= 0');

          const stock = Number(stockStr);
          if (isNaN(stock) || stock < 0) throw new BadRequestException('Stock must be a valid number >= 0');

          // Optional fields
          const originalPriceStr = String(getSafely('Original Price (QAR)') || '0').trim();
          const originalPrice = Number(originalPriceStr);

          const weightStr = String(getSafely('Weight (grams)') || '0').trim();
          const weight = Number(weightStr);

          const tierPriceStr = String(getSafely('Price per Tola/Quarter Tola/Piece (QAR)') || '0').trim();
          const tierPrice = Number(tierPriceStr);

          const lowStockStr = String(getSafely('Low Stock Threshold') || '10').trim();
          const lowStockThreshold = Number(lowStockStr);

          const badge = String(getSafely('English Badge') || '').trim();
          const badgeAr = String(getSafely('Arabic Badge') || '').trim();

          const mainImage = String(getSafely('Main Image URL') || '').trim();
          const imagesStr = String(getSafely('All Images (comma separated)') || '').trim();
          // Accept both comma and semicolon separators for image lists for better compatibility
          const images = imagesStr
            .split(/[,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);

          const isNewArrivalStr = String(getSafely('New Arrival') || 'No').toLowerCase().trim();
          const isNewArrival = isNewArrivalStr === 'yes' || isNewArrivalStr === 'true' || isNewArrivalStr === '1';

          const isBestsellerStr = String(getSafely('Bestseller') || 'No').toLowerCase().trim();
          const isBestseller = isBestsellerStr === 'yes' || isBestsellerStr === 'true' || isBestsellerStr === '1';

          const isLimitedStr = String(getSafely('Limited Edition') || 'No').toLowerCase().trim();
          const isLimitedEdition = isLimitedStr === 'yes' || isLimitedStr === 'true' || isLimitedStr === '1';

          const isFeaturedStr = String(getSafely('Featured') || 'No').toLowerCase().trim();
          const isFeatured = isFeaturedStr === 'yes' || isFeaturedStr === 'true' || isFeaturedStr === '1';

          const status = String(getSafely('Status') || 'active').trim().toLowerCase();
          if (!['active', 'inactive', 'draft'].includes(status)) throw new BadRequestException('Status must be active, inactive, or draft');

          const categoryRecord = await this.categoryModel.findOne({ name: categoryName }).select('_id name slug').lean();

          // Generate slug from English name
          const slug = name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');

          // Check if product with same SKU already exists
          const existingProduct = await this.productModel.findOne({ sku });

          const productData = {
            sku,
            name,
            nameAr,
            slug,
            categoryName,
            category: categoryRecord?._id ? new Types.ObjectId(String(categoryRecord._id)) : undefined,
            categorySlug: String((categoryRecord as any)?.slug || categoryName)
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/(^-|-$)/g, ''),
            price,
            originalPrice: originalPrice || undefined,
            unit: unitStr,
            weight: weight || undefined,
            pricePerTola: tierPrice || undefined,
            pricePerQuarterTola: tierPrice || undefined,
            pricePerPiece: tierPrice || undefined,
            stock,
            lowStockThreshold: lowStockThreshold || 10,
            image: mainImage || undefined,
            images: images.length > 0 ? images : [],
            description: String(getSafely('English Description') || '').trim(),
            descriptionAr: String(getSafely('Arabic Description') || '').trim(),
            badge: badge || undefined,
            badgeAr: badgeAr || undefined,
            isNewArrival,
            isBestseller,
            isLimitedEdition,
            isFeatured,
            status,
          };

          if (existingProduct) {
            // Update existing product
            await this.productModel.findByIdAndUpdate(existingProduct._id, productData);
            updated.push({ sku, name, row: rowNum });
          } else {
            // Create new product
            await this.productModel.create(productData);
            created.push({ sku, name, row: rowNum });
          }
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          errors.push({ row: rowNum, error: errorMsg });
        }
      }

      return {
        message: 'Import completed',
        summary: {
          created: created.length,
          updated: updated.length,
          errors: errors.length,
        },
        createdProducts: created,
        updatedProducts: updated,
        errors,
      };
    } catch (err: any) {
      throw new BadRequestException(`Import failed: ${err?.message || String(err)}`);
    }
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
      pricePerQuarterTola: (p as any).pricePerQuarterTola,
      pricePerPiece: (p as any).pricePerPiece,
      unit: (p as any).unit,
      image: p.image,
      images: p.images,
      slug: p.slug,
      href: (p as any).categorySlug || p.categoryName
        ? `/shop/${(p as any).categorySlug || this.generatePathSegment(p.categoryName)}/${p.slug}`
        : `/shop/${p.slug}`,
      itemCode: (p as any).itemCode,
      category: p.category,
      categoryName: p.categoryName,
      categorySlug: (p as any).categorySlug || this.generatePathSegment(p.categoryName),
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
      isOnOffer: (p as any).isOnOffer ?? false,
      offerPrice: (p as any).offerPrice ?? 0,
      offerDiscountPercent: (p as any).offerDiscountPercent ?? 0,
      offerStartDate: (p as any).offerStartDate || null,
      offerEndDate: (p as any).offerEndDate || null,
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
      pricePerQuarterTola: (p as any).pricePerQuarterTola,
      pricePerPiece: (p as any).pricePerPiece,
      unit: (p as any).unit,
      image: p.image || '',
      images: p.images || [],
      stock: p.stock,
      sku: p.sku,  // ADD: SKU field
      itemCode: (p as any).itemCode,  // ADD: Item code
      category: (p as any).category,  // ADD: Category ObjectId
      categoryName: (p as any).categoryName,  // ADD: Category name for display
      categorySlug: (p as any).categorySlug || this.generatePathSegment(p.categoryName),
      lowStockThreshold: (p as any).lowStockThreshold,
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
      isOnOffer: (p as any).isOnOffer ?? false,
      offerPrice: (p as any).offerPrice ?? 0,
      offerDiscountPercent: (p as any).offerDiscountPercent ?? 0,
      offerStartDate: (p as any).offerStartDate || null,
      offerEndDate: (p as any).offerEndDate || null,
      isAvailable: p.stock > 0,
      sales: p.sales,
      status: p.status,
      weight: p.weight,
      createdAt: (p as any).createdAt,
    };
  }
}
