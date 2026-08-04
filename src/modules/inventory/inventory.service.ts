import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../auth/mail.service';
import * as XLSX from 'xlsx';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    private whatsAppService: WhatsAppService,
    private notificationsService: NotificationsService,
    private mailService: MailService,
    private configService: ConfigService,
  ) {}

  // Known category-name variants (typos / inconsistent bulk-import casing) that should be
  // reported as a single unified category instead of showing up as separate duplicates.
  private readonly categoryNameVariants: Record<string, string> = {
    'al oud': 'Oud',
    'oud': 'Oud',
    'gift boxs': 'Gift Boxes and Giveaways',
    'gift boxes and giveaways': 'Gift Boxes and Giveaways',
  };

  private normalizeCategoryName(name?: string): string {
    const trimmed = String(name || '').trim();
    if (!trimmed) return trimmed;
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
    return this.categoryNameVariants[key] || trimmed;
  }

  private generatePathSegment(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  private getProductUrl(p: { slug?: string; categorySlug?: string; categoryName?: string }): string {
    const frontendUrl = (this.configService.get<string>('FRONTEND_URL', 'https://oudalzubarah.com') || '').replace(/\/+$/, '');
    const categorySegment = p.categorySlug || this.generatePathSegment(p.categoryName);
    return `${frontendUrl}/shop/${categorySegment ? `${categorySegment}/` : ''}${p.slug || ''}`;
  }

  private normalizeImportHeader(header: any): string {
    return String(header ?? '')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_\-()]+/g, '');
  }

  private findHeaderIndex(headers: any[], aliases: string[]): number {
    const normalizedHeaders = headers.map((h) => this.normalizeImportHeader(h));
    const normalizedAliases = aliases.map((a) => this.normalizeImportHeader(a));

    for (const alias of normalizedAliases) {
      const exact = normalizedHeaders.findIndex((h) => h === alias);
      if (exact >= 0) return exact;

      const fuzzy = normalizedHeaders.findIndex((h) => h.includes(alias) || alias.includes(h));
      if (fuzzy >= 0) return fuzzy;
    }

    return -1;
  }

  private parseCellString(value: any): string {
    return String(value ?? '').trim();
  }

  private parseCellNumber(value: any): number {
    const normalized = String(value ?? '')
      .trim()
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[\u066B,]/g, '.')
      .replace(/[\u066C\s]/g, '');
    if (!normalized) return NaN;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  // Get all inventory items with filters
  async getInventory(query: {
    search?: string;
    stockLevel?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, stockLevel, page = 1, limit = 20 } = query;
    // Inventory only ever shows Active products — Inactive/Draft/Archived are excluded.
    const filter: any = { status: 'active' };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    if (stockLevel === 'out') filter.stock = 0;
    else if (stockLevel === 'low') {
      filter.$expr = { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] };
    }
    else if (stockLevel === 'adequate') {
      filter.$expr = { $gt: ['$stock', '$lowStockThreshold'] };
    }

    const total = await this.productModel.countDocuments(filter);
    const products = await this.productModel
      .find(filter)
      .select('name nameAr sku itemCode stock price pricePerTola pricePerQuarterTola pricePerPiece unit inventoryType status image sales category categoryName lowStockThreshold')
      .sort({ stock: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      items: products.map((p) => ({
        _id: p._id,
        id: p._id,
        name: p.name,
        nameAr: p.nameAr,
        sku: p.sku,
        itemCode: (p as any).itemCode,
        stock: p.stock,
        price: p.price,
        pricePerTola: (p as any).pricePerTola,
        pricePerQuarterTola: (p as any).pricePerQuarterTola,
        pricePerPiece: (p as any).pricePerPiece,
        unit: (p as any).unit,
        inventoryType: (p as any).inventoryType || 'gram-based',
        status: p.status,
        image: p.image,
        sales: p.sales,
        categoryName: p.categoryName,
        lowStockThreshold: (p as any).lowStockThreshold,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Update stock for a single product
  async updateStock(productId: string, stock: number) {
    const product = await this.productModel.findByIdAndUpdate(
      productId,
      { stock },
      { returnDocument: 'after' },
    );
    if (!product) throw new NotFoundException('Product not found');

    // Check low stock using per-product threshold (skip draft/archived products)
    const threshold = (product as any).lowStockThreshold || 10;
    if (product.status === 'active' && stock <= threshold && stock >= 0) {
      const unit = (product as any).unit || 'units';
      const alertMsg = `Product ${product.name} is almost out of stock. Remaining quantity: ${stock} ${unit.toLowerCase()}.`;
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert',
        alertMsg,
        'stock',
        { productId: product._id, stock },
      );
      this.whatsAppService.sendLowStockAlert('admin', product.name, stock);
      // Send email alert
      try {
        await this.mailService.sendLowStockAlert(product.name, stock, unit);
      } catch (e) { /* email failure should not block */ }
    }

    return { message: 'Stock updated', product: { id: product._id, name: product.name, stock } };
  }

  // Bulk update stock
  async bulkUpdateStock(updates: { productId: string; stock: number }[]) {
    const results: any[] = [];
    const lowStockAlerts: string[] = [];

    for (const update of updates) {
      const product = await this.productModel.findByIdAndUpdate(
        update.productId,
        { stock: update.stock },
        { returnDocument: 'after' },
      );
      if (product) {
        results.push({ id: product._id, name: product.name, stock: update.stock });
        if (product.status === 'active' && update.stock <= 5) {
          lowStockAlerts.push(`${product.name} (${update.stock})`);
        }
      }
    }

    if (lowStockAlerts.length > 0) {
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert - Bulk Update',
        `Low stock items: ${lowStockAlerts.join(', ')}`,
        'stock',
        { items: lowStockAlerts },
      );
    }

    return { message: `${results.length} items updated`, results };
  }

  // Get inventory stats
  async getStats() {
    const totalProducts = await this.productModel.countDocuments({ status: 'active' });
    const inStock = await this.productModel.countDocuments({ stock: { $gt: 0 }, status: 'active' });
    const outOfStock = await this.productModel.countDocuments({ stock: 0, status: 'active' });
    // Low stock: stock > 0 AND stock <= lowStockThreshold (per product)
    const lowStock = await this.productModel.countDocuments({
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] },
      status: 'active',
    });

    const totalStockValue = await this.productModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$price', '$stock'] } } } },
    ]);

    // Get actual items SOLD (from sales field) instead of inventory units
    const totalSold = await this.productModel.aggregate([
      { $group: { _id: null, sold: { $sum: '$sales' } } },
    ]);

    const lowStockItems = await this.productModel
      .find({
        $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] },
        status: 'active',
      })
      .select('name nameAr sku itemCode stock unit image lowStockThreshold')
      .sort({ stock: 1 })
      .limit(10);

    const outOfStockItems = await this.productModel
      .find({ stock: 0, status: 'active' })
      .select('name nameAr sku itemCode image')
      .limit(10);

    return {
      totalProducts,
      inStock,
      outOfStock,
      lowStock,
      totalStockValue: totalStockValue[0]?.value || 0,
      totalUnits: totalSold[0]?.sold || 0, // Changed to show actual items sold
      lowStockItems,
      outOfStockItems,
    };
  }

  // Export inventory as Excel
  async exportToExcel(): Promise<Buffer> {
    const products = await this.productModel
      .find({ status: 'active' })
      .select('name nameAr sku slug stock price pricePerTola pricePerQuarterTola pricePerPiece unit inventoryType status categoryName categorySlug sales lowStockThreshold image')
      .sort({ name: 1 });

    const columnOrder = ['SKU', 'Product ID', 'English Name', 'Arabic Name', 'Unit', 'Inventory Type', 'Available Quantity', 'Price per Unit', 'Price per Tola/Quarter Tola/Piece', 'Category', 'Status', 'Sales', 'Low Stock Threshold', 'Image URL', 'Product URL'];

    const rows: any[][] = [columnOrder]; // Header row

    for (const p of products) {
      const unit = (p as any).unit || 'Grams';
      const inventoryType = (p as any).inventoryType || 'gram-based';
      // Use pricePerPiece for Piece units, pricePerQuarterTola for Quarter Tola, pricePerTola for Tola/kg units
      let tierPrice = 0;
      if (unit === 'Piece' && (p as any).pricePerPiece) {
        tierPrice = (p as any).pricePerPiece;
      } else if (unit === 'Quarter Tola' && (p as any).pricePerQuarterTola) {
        tierPrice = (p as any).pricePerQuarterTola;
      } else if ((unit === 'Tola' || unit === 'kg') && (p as any).pricePerTola) {
        tierPrice = (p as any).pricePerTola;
      }

      const row = [
        String(p.sku || ''),
        String(p._id || ''),
        String(p.name || ''),
        String(p.nameAr || ''),
        String(unit),
        String(inventoryType),
        Number(p.stock) || 0,
        Number(p.price) || 0,
        Number(tierPrice) || 0,
        this.normalizeCategoryName(p.categoryName),
        String(p.status || ''),
        Number((p as any).sales) || 0,
        Number((p as any).lowStockThreshold) || 10,
        String((p as any).image || ''),
        this.getProductUrl(p as any),
      ];
      rows.push(row);
    }

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 15 }, // SKU
      { wch: 26 }, // Product ID
      { wch: 30 }, // English Name
      { wch: 30 }, // Arabic Name
      { wch: 12 }, // Unit
      { wch: 15 }, // Inventory Type
      { wch: 18 }, // Quantity
      { wch: 14 }, // Price per Unit
      { wch: 18 }, // Price per Tola
      { wch: 20 }, // Category
      { wch: 10 }, // Status
      { wch: 10 }, // Sales
      { wch: 18 }, // Low Stock Threshold
      { wch: 40 }, // Image URL
      { wch: 45 }, // Product URL
    ];

    // Set text direction for Arabic columns
    worksheet['!rtl'] = true;

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: false }));
  }

  // Import inventory from Excel (matches client's actual file format)
  // Client's Excel has header rows (company info) above the data table.
  // Columns: Item Code | English Name | Arabic Name | Description EN | Description AR | Category | SKU
  //          Unit | Quantity | Price per gram | Price per tola | Status | Low Stock Threshold | Image URL
  async importFromExcel(file: Buffer) {
    const workbook = XLSX.read(file, {
      type: 'buffer',
      codepage: 65001,
      raw: false,
      cellText: true,
    });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert entire sheet to array of arrays to find the header row
    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    if (!rawData.length) throw new BadRequestException('Empty file');

    // Find the header row by looking for 'Item Code' or 'English Name' or similar keywords
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rawData.length, 15); i++) {
      const row = rawData[i];
      if (!row) continue;
      const rowStr = row.map((c: any) => String(c || '').toLowerCase()).join('|');
      if (rowStr.includes('item code') || rowStr.includes('english name') || rowStr.includes('english')) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) {
      // Fallback: try to parse as simple JSON format
      const data: any[] = XLSX.utils.sheet_to_json(worksheet);
      if (!data.length) throw new BadRequestException('Could not find header row in file');
      return this.importSimpleFormat(data);
    }

    // Map column indices by header names
    const headers = rawData[headerRowIndex] || [];
    const colMap = {
      itemCode: this.findHeaderIndex(headers, ['item code', 'itemcode', 'item_code', 'code', 'رمزالعنصر']),
      englishName: this.findHeaderIndex(headers, ['english name', 'name en', 'product name en', 'name']),
      arabicName: this.findHeaderIndex(headers, ['arabic name', 'name ar', 'product name ar', 'الاسمالعربي']),
      descriptionEn: this.findHeaderIndex(headers, ['description en', 'english description', 'descriptionenglish']),
      descriptionAr: this.findHeaderIndex(headers, ['description ar', 'arabic description', 'descriptionarabic']),
      category: this.findHeaderIndex(headers, ['category', 'category name', 'الفئة']),
      sku: this.findHeaderIndex(headers, ['sku', 'product sku']),
      unit: this.findHeaderIndex(headers, ['unit', 'الوحدة']),
      inventoryType: this.findHeaderIndex(headers, ['inventory type', 'inventory', 'نوع المخزون']),
      quantity: this.findHeaderIndex(headers, ['available quantity', 'quantity', 'stock', 'الكمية', 'المتاحة']),
      pricePerUnit: this.findHeaderIndex(headers, ['price per gram', 'price per unit', 'unit price', 'السعرلكلجرام']),
      pricePerTola: this.findHeaderIndex(headers, ['price per tola', 'price per quarter tola', 'price per piece', 'السعرلكلتولة']),
      status: this.findHeaderIndex(headers, ['status', 'الحالة']),
      lowStockThreshold: this.findHeaderIndex(headers, ['low stock threshold', 'threshold', 'حدالمخزونالمنخفض']),
      imageUrl: this.findHeaderIndex(headers, ['image url', 'image', 'photo', 'picture', 'رابطالصورة']),
    };

    // If we can't find quantity column by header name, look for numeric column after unit
    // Also try Arabic headers
    const results = { created: 0, updated: 0, errors: 0, skipped: 0 };
    const lowStockAlerts: string[] = [];

    // Process data rows (skip header row)
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !row.length) continue;

      try {
        const itemCode = colMap.itemCode >= 0 ? this.parseCellString(row[colMap.itemCode]) : '';
        const englishName = colMap.englishName >= 0 ? this.parseCellString(row[colMap.englishName]) : '';
        const arabicName = colMap.arabicName >= 0 ? this.parseCellString(row[colMap.arabicName]) : '';
        const descriptionEn = colMap.descriptionEn >= 0 ? this.parseCellString(row[colMap.descriptionEn]) : '';
        const descriptionAr = colMap.descriptionAr >= 0 ? this.parseCellString(row[colMap.descriptionAr]) : '';
        const category = colMap.category >= 0 ? this.parseCellString(row[colMap.category]) : '';
        const skuFromFile = colMap.sku >= 0 ? this.parseCellString(row[colMap.sku]) : '';
        const unit = colMap.unit >= 0 ? this.parseCellString(row[colMap.unit]) || 'Grams' : 'Grams';
        const inventoryTypeRaw = colMap.inventoryType >= 0 ? this.parseCellString(row[colMap.inventoryType]).toLowerCase() : '';
        const inventoryType = (['gram-based', 'piece-based'].includes(inventoryTypeRaw) ? inventoryTypeRaw : 'gram-based');
        const quantity = colMap.quantity >= 0 ? this.parseCellNumber(row[colMap.quantity]) : NaN;
        const pricePerUnit = colMap.pricePerUnit >= 0 ? this.parseCellNumber(row[colMap.pricePerUnit]) : NaN;
        const pricePerTola = colMap.pricePerTola >= 0 ? this.parseCellNumber(row[colMap.pricePerTola]) : NaN;
        const statusRaw = colMap.status >= 0 ? this.parseCellString(row[colMap.status]).toLowerCase() : '';
        const lowStockThreshold = colMap.lowStockThreshold >= 0 ? this.parseCellNumber(row[colMap.lowStockThreshold]) : NaN;
        const imageUrl = colMap.imageUrl >= 0 ? this.parseCellString(row[colMap.imageUrl]) : '';

        // Skip rows without any matching key
        if (!itemCode && !englishName && !skuFromFile) {
          results.skipped++;
          continue;
        }

        // Try to find existing product by SKU first, then by itemCode, then by name
        let product: ProductDocument | null = null;
        if (skuFromFile) {
          product = await this.productModel.findOne({
            $or: [{ sku: skuFromFile }, { itemCode: skuFromFile }],
          });
        }
        if (!product && itemCode) {
          product = await this.productModel.findOne({ itemCode });
        }
        if (!product && englishName) {
          product = await this.productModel.findOne({ name: { $regex: `^${englishName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        }

        const updateData: any = {};
        if (!isNaN(quantity)) updateData.stock = Math.round(quantity * 100) / 100;
        if (englishName) updateData.name = englishName;
        if (skuFromFile) updateData.sku = skuFromFile;
        if (descriptionEn) updateData.description = descriptionEn;
        if (descriptionAr) updateData.descriptionAr = descriptionAr;
        if (category) updateData.categoryName = category;
        if (!isNaN(pricePerUnit) && pricePerUnit > 0) updateData.price = pricePerUnit;
        if (inventoryType) updateData.inventoryType = inventoryType;
        
        // Handle pricePerTola/pricePerQuarterTola/pricePerPiece based on unit
        if (!isNaN(pricePerTola) && pricePerTola > 0) {
          if (unit === 'Piece') {
            updateData.pricePerPiece = pricePerTola;
          } else if (unit === 'Quarter Tola') {
            updateData.pricePerQuarterTola = pricePerTola;
          } else if (unit === 'Tola' || unit === 'kg') {
            updateData.pricePerTola = pricePerTola;
          }
        }
        
        if (unit) updateData.unit = unit;
        if (arabicName) updateData.nameAr = arabicName;
        if (!isNaN(lowStockThreshold) && lowStockThreshold >= 0) updateData.lowStockThreshold = lowStockThreshold;
        if (['active', 'draft', 'archived'].includes(statusRaw)) updateData.status = statusRaw;
        if (imageUrl) {
          updateData.image = imageUrl;
          updateData.images = [imageUrl];
        }

        if (product) {
          // Update existing product
          await this.productModel.findByIdAndUpdate(product._id, { $set: updateData });
          results.updated++;
        } else {
          // Create new product
          const slug = englishName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          await this.productModel.create({
            name: englishName || `Product ${itemCode}`,
            nameAr: arabicName || englishName || itemCode,
            description: descriptionEn || englishName || itemCode,
            descriptionAr: descriptionAr || arabicName || englishName || itemCode,
            price: !isNaN(pricePerUnit) && pricePerUnit > 0 ? pricePerUnit : 0,
            pricePerTola: (unit === 'Tola' || unit === 'kg') && pricePerTola && !isNaN(pricePerTola) ? pricePerTola : 0,
            pricePerPiece: unit === 'Piece' && pricePerTola && !isNaN(pricePerTola) ? pricePerTola : 0,
            sku: skuFromFile || itemCode || `SKU-${Date.now()}-${i}`,
            itemCode: itemCode,
            slug: slug || `product-${itemCode}-${Date.now()}`,
            unit: unit,
            inventoryType: inventoryType,
            stock: !isNaN(quantity) ? Math.round(quantity * 100) / 100 : 0,
            categoryName: category,
            image: imageUrl || '',
            images: imageUrl ? [imageUrl] : [],
            status: ['active', 'draft', 'archived'].includes(statusRaw) ? statusRaw : 'active',
            lowStockThreshold: !isNaN(lowStockThreshold) && lowStockThreshold >= 0 ? lowStockThreshold : 10,
          });
          results.created++;
        }

        // Check low stock
        if (!isNaN(quantity)) {
          const currentStock = Math.round(quantity * 100) / 100;
          const threshold = product ? ((product as any).lowStockThreshold || 10) : 10;
          if (currentStock > 0 && currentStock <= threshold) {
            lowStockAlerts.push(`${englishName || product?.name} (${currentStock} ${unit.toLowerCase()})`);
          }
        }
      } catch (err) {
        results.errors++;
      }
    }

    if (lowStockAlerts.length > 0) {
      const alertMsg = `Low stock after import: ${lowStockAlerts.join(', ')}`;
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert - Excel Import',
        alertMsg,
        'stock',
        { items: lowStockAlerts },
      );

      // Send WhatsApp alerts for each low stock item
      for (const alert of lowStockAlerts) {
        // Extract product name and stock from alert string
        const match = alert.match(/^(.+?)\s*\((\d+)\s/);
        if (match) {
          const productName = match[1];
          const stock = parseInt(match[2], 10);
          try {
            this.whatsAppService.sendLowStockAlert('admin', productName, stock);
          } catch (e) {
            console.warn(`⚠️ Failed to send WhatsApp low stock alert for ${productName}:`, e);
          }
        }
      }

      // Send email alert for imported low stock items
      try {
        await this.mailService.sendLowStockBulkAlert(lowStockAlerts);
      } catch (e) { /* email failure should not block */ }
    }

    return {
      message: `Import completed: ${results.created} created, ${results.updated} updated, ${results.skipped} skipped, ${results.errors} errors`,
      ...results,
      totalRows: rawData.length - headerRowIndex - 1,
    };
  }

  // Fallback import for simple SKU/Stock format
  private async importSimpleFormat(data: any[]) {
    const results = { created: 0, updated: 0, errors: 0, skipped: 0 };

    for (const row of data) {
      try {
        const sku = this.parseCellString(row.SKU || row.sku || row['Item Code'] || row.item_code);
        const name = this.parseCellString(row['English Name'] || row.name);
        const nameAr = this.parseCellString(row['Arabic Name'] || row.nameAr || row.name_ar);
        const description = this.parseCellString(row['Description EN'] || row.description);
        const descriptionAr = this.parseCellString(row['Description AR'] || row.descriptionAr || row.description_ar);
        const categoryName = this.parseCellString(row.Category || row.category);
        const stock = this.parseCellNumber(row.Stock || row.stock || row['Available Quantity'] || row.quantity);
        const price = this.parseCellNumber(row.Price || row.price || row['Price per Unit']);
        const statusRaw = this.parseCellString(row.Status || row.status).toLowerCase();
        const lowStockThreshold = this.parseCellNumber(row['Low Stock Threshold'] || row.lowStockThreshold || row.threshold);
        const imageUrl = this.parseCellString(row['Image URL'] || row.image || row.imageUrl || row.photo);

        if (!sku && !name) {
          results.skipped++;
          continue;
        }

        const updateData: any = {};
        if (name) updateData.name = name;
        if (nameAr) updateData.nameAr = nameAr;
        if (description) updateData.description = description;
        if (descriptionAr) updateData.descriptionAr = descriptionAr;
        if (categoryName) updateData.categoryName = categoryName;
        if (!isNaN(stock)) updateData.stock = stock;
        if (!isNaN(price) && price > 0) updateData.price = price;
        if (['active', 'draft', 'archived'].includes(statusRaw)) updateData.status = statusRaw;
        if (!isNaN(lowStockThreshold) && lowStockThreshold >= 0) updateData.lowStockThreshold = lowStockThreshold;
        if (imageUrl) {
          updateData.image = imageUrl;
          updateData.images = [imageUrl];
        }

        const product = await this.productModel.findOneAndUpdate(
          { $or: [{ sku }, { itemCode: sku }, ...(name ? [{ name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }] : [])] },
          { $set: updateData },
          { returnDocument: 'after' },
        );

        if (product) results.updated++;
        else results.skipped++;
      } catch {
        results.errors++;
      }
    }

    return {
      message: `Import completed: ${results.updated} updated, ${results.skipped} skipped, ${results.errors} errors`,
      ...results,
      totalRows: data.length,
    };
  }

  // Check and alert low stock items (can be called periodically)
  async checkLowStock(threshold?: number) {
    let filter: any;
    if (threshold) {
      // Use explicit threshold override
      filter = { stock: { $gt: 0, $lte: threshold }, status: 'active' };
    } else {
      // Use per-product threshold
      filter = {
        $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] },
        status: 'active',
      };
    }

    const lowStockProducts = await this.productModel.find(filter);

    if (lowStockProducts.length > 0) {
      const names = lowStockProducts.map((p) => {
        const unit = (p as any).unit || 'units';
        return `${p.name} (${p.stock} ${unit.toLowerCase()})`;
      }).join(', ');

      await this.notificationsService.notifyAdmins(
        'Low Stock Report',
        `${lowStockProducts.length} products below threshold: ${names}`,
        'stock',
        { count: lowStockProducts.length, items: lowStockProducts.map((p) => ({ id: p._id, name: p.name, stock: p.stock })) },
      );

      for (const product of lowStockProducts) {
        this.whatsAppService.sendLowStockAlert('admin', product.name, product.stock);
      }

      // Send email alert
      try {
        const alertItems = lowStockProducts.map((p) => {
          const unit = (p as any).unit || 'units';
          return `${p.name} (${p.stock} ${unit.toLowerCase()})`;
        });
        await this.mailService.sendLowStockBulkAlert(alertItems);
      } catch (e) { /* email failure should not block */ }
    }

    return {
      lowStockCount: lowStockProducts.length,
      items: lowStockProducts.map((p) => ({
        _id: p._id,
        id: p._id,
        name: p.name,
        sku: p.sku,
        itemCode: (p as any).itemCode,
        stock: p.stock,
        unit: (p as any).unit,
        lowStockThreshold: (p as any).lowStockThreshold,
      })),
    };
  }
}
