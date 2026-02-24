import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
  ) {}

  // Get all inventory items with filters
  async getInventory(query: {
    search?: string;
    status?: string;
    stockLevel?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, stockLevel, page = 1, limit = 20 } = query;
    const filter: any = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { nameAr: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
      ];
    }

    if (status) filter.status = status;

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
      .select('name nameAr sku itemCode stock price pricePerTola unit status image sales category categoryName lowStockThreshold')
      .sort({ stock: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      items: products.map((p) => ({
        id: p._id,
        name: p.name,
        nameAr: p.nameAr,
        sku: p.sku,
        itemCode: (p as any).itemCode,
        stock: p.stock,
        price: p.price,
        pricePerTola: (p as any).pricePerTola,
        unit: (p as any).unit,
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
      { new: true },
    );
    if (!product) throw new NotFoundException('Product not found');

    // Check low stock using per-product threshold
    const threshold = (product as any).lowStockThreshold || 10;
    if (stock <= threshold && stock >= 0) {
      const unit = (product as any).unit || 'units';
      const alertMsg = `Product ${product.name} is almost out of stock. Remaining quantity: ${stock} ${unit.toLowerCase()}.`;
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert',
        alertMsg,
        'stock',
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
        { new: true },
      );
      if (product) {
        results.push({ id: product._id, name: product.name, stock: update.stock });
        if (update.stock <= 5) {
          lowStockAlerts.push(`${product.name} (${update.stock})`);
        }
      }
    }

    if (lowStockAlerts.length > 0) {
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert - Bulk Update',
        `Low stock items: ${lowStockAlerts.join(', ')}`,
        'stock',
      );
    }

    return { message: `${results.length} items updated`, results };
  }

  // Get inventory stats
  async getStats() {
    const totalProducts = await this.productModel.countDocuments();
    const inStock = await this.productModel.countDocuments({ stock: { $gt: 0 } });
    const outOfStock = await this.productModel.countDocuments({ stock: 0 });
    // Low stock: stock > 0 AND stock <= lowStockThreshold (per product)
    const lowStock = await this.productModel.countDocuments({
      $expr: { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', '$lowStockThreshold'] }] },
    });

    const totalStockValue = await this.productModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$price', '$stock'] } } } },
    ]);

    const totalUnits = await this.productModel.aggregate([
      { $group: { _id: null, units: { $sum: '$stock' } } },
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
      totalUnits: totalUnits[0]?.units || 0,
      lowStockItems,
      outOfStockItems,
    };
  }

  // Export inventory as Excel
  async exportToExcel(): Promise<Buffer> {
    const products = await this.productModel
      .find()
      .select('name nameAr sku itemCode stock price pricePerTola unit status categoryName sales lowStockThreshold')
      .sort({ name: 1 });

    const data = products.map((p) => ({
      'Item Code': (p as any).itemCode || '',
      'English Name': p.name,
      'Arabic Name': p.nameAr,
      Unit: (p as any).unit || 'Grams',
      'Available Quantity': p.stock,
      'Price per Unit': p.price,
      'Price per Tola/Piece': (p as any).pricePerTola || 0,
      SKU: p.sku,
      Category: p.categoryName,
      Status: p.status,
      Sales: p.sales,
      'Low Stock Threshold': (p as any).lowStockThreshold || 10,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 12 }, // Item Code
      { wch: 30 }, // English Name
      { wch: 30 }, // Arabic Name
      { wch: 10 }, // Unit
      { wch: 18 }, // Quantity
      { wch: 14 }, // Price per Unit
      { wch: 18 }, // Price per Tola
      { wch: 15 }, // SKU
      { wch: 20 }, // Category
      { wch: 10 }, // Status
      { wch: 10 }, // Sales
      { wch: 18 }, // Low Stock Threshold
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  }

  // Import inventory from Excel (matches client's actual file format)
  // Client's Excel has header rows (company info) above the data table.
  // Columns: Item Code | English Name | Arabic Name | Unit | Quantity | Price per gram | Price per tola
  async importFromExcel(file: Buffer) {
    const workbook = XLSX.read(file, { type: 'buffer' });
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
    const headers = rawData[headerRowIndex].map((h: any) => String(h || '').trim().toLowerCase());
    const colMap = {
      itemCode: headers.findIndex((h: string) => h.includes('item code') || h === 'item_code'),
      englishName: headers.findIndex((h: string) => h.includes('english') && h.includes('name')),
      arabicName: headers.findIndex((h: string) => h.includes('arabic') && h.includes('name')),
      unit: headers.findIndex((h: string) => h === 'unit' || h.includes('unit')),
      quantity: headers.findIndex((h: string) => h.includes('quantity') || h.includes('الكمية') || h.includes('المتاحة')),
      pricePerUnit: headers.findIndex((h: string) => h.includes('price') && (h.includes('gram') || h.includes('unit') || h.includes('الجرام'))),
      pricePerTola: headers.findIndex((h: string) => h.includes('price') && (h.includes('tola') || h.includes('piece') || h.includes('التولة'))),
    };

    // If we can't find quantity column by header name, look for numeric column after unit
    // Also try Arabic headers
    if (colMap.quantity === -1) {
      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (h.includes('الكمية') || h.includes('المتاحة') || h.includes('بالجرام')) {
          colMap.quantity = i;
          break;
        }
      }
    }
    if (colMap.pricePerUnit === -1) {
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].includes('سعر') && (headers[i].includes('الجرام') || headers[i].includes('الحبة'))) {
          if (colMap.pricePerTola === -1 || i < colMap.pricePerTola) {
            colMap.pricePerUnit = i;
          }
        }
      }
    }
    if (colMap.pricePerTola === -1) {
      for (let i = 0; i < headers.length; i++) {
        if (headers[i].includes('سعر') && (headers[i].includes('التولة') || headers[i].includes('تولة'))) {
          colMap.pricePerTola = i;
        }
      }
    }

    const results = { created: 0, updated: 0, errors: 0, skipped: 0 };
    const lowStockAlerts: string[] = [];

    // Process data rows (skip header row)
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || !row.length) continue;

      try {
        const itemCode = colMap.itemCode >= 0 ? String(row[colMap.itemCode] || '').trim() : '';
        const englishName = colMap.englishName >= 0 ? String(row[colMap.englishName] || '').trim() : '';
        const arabicName = colMap.arabicName >= 0 ? String(row[colMap.arabicName] || '').trim() : '';
        const unit = colMap.unit >= 0 ? String(row[colMap.unit] || 'Grams').trim() : 'Grams';
        const quantity = colMap.quantity >= 0 ? parseFloat(row[colMap.quantity]) : NaN;
        const pricePerUnit = colMap.pricePerUnit >= 0 ? parseFloat(row[colMap.pricePerUnit]) : NaN;
        const pricePerTola = colMap.pricePerTola >= 0 ? parseFloat(row[colMap.pricePerTola]) : 0;

        // Skip rows without item code or name
        if (!itemCode && !englishName) {
          results.skipped++;
          continue;
        }

        if (isNaN(quantity)) {
          results.skipped++;
          continue;
        }

        // Try to find existing product by itemCode first, then by name
        let product: ProductDocument | null = null;
        if (itemCode) {
          product = await this.productModel.findOne({ itemCode });
        }
        if (!product && englishName) {
          product = await this.productModel.findOne({ name: { $regex: `^${englishName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } });
        }

        const updateData: any = {
          stock: Math.round(quantity * 100) / 100,
        };
        if (!isNaN(pricePerUnit) && pricePerUnit > 0) updateData.price = pricePerUnit;
        if (pricePerTola && !isNaN(pricePerTola)) updateData.pricePerTola = pricePerTola;
        if (unit) updateData.unit = unit;
        if (arabicName) updateData.nameAr = arabicName;

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
            description: englishName || itemCode,
            descriptionAr: arabicName || englishName || itemCode,
            price: !isNaN(pricePerUnit) && pricePerUnit > 0 ? pricePerUnit : 0,
            pricePerTola: pricePerTola && !isNaN(pricePerTola) ? pricePerTola : 0,
            sku: itemCode || `SKU-${Date.now()}-${i}`,
            itemCode: itemCode,
            slug: slug || `product-${itemCode}-${Date.now()}`,
            unit: unit,
            stock: Math.round(quantity * 100) / 100,
            status: 'active',
            lowStockThreshold: 10,
          });
          results.created++;
        }

        // Check low stock
        const currentStock = Math.round(quantity * 100) / 100;
        const threshold = product ? ((product as any).lowStockThreshold || 10) : 10;
        if (currentStock > 0 && currentStock <= threshold) {
          lowStockAlerts.push(`${englishName || product?.name} (${currentStock} ${unit.toLowerCase()})`);
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
      );
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
        const sku = row.SKU || row.sku || row['Item Code'] || row.item_code;
        const stock = parseFloat(row.Stock || row.stock || row['Available Quantity'] || row.quantity);
        const price = parseFloat(row.Price || row.price || row['Price per Unit']);

        if (!sku || isNaN(stock)) {
          results.skipped++;
          continue;
        }

        const updateData: any = { stock };
        if (!isNaN(price) && price > 0) updateData.price = price;

        const product = await this.productModel.findOneAndUpdate(
          { $or: [{ sku }, { itemCode: sku }] },
          { $set: updateData },
          { new: true },
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
