import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationsService } from '../notifications/notifications.service';
import * as XLSX from 'xlsx';

@Injectable()
export class InventoryService {
  constructor(
    @InjectModel(Product.name) private productModel: Model<ProductDocument>,
    private whatsAppService: WhatsAppService,
    private notificationsService: NotificationsService,
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
    else if (stockLevel === 'low') filter.stock = { $gt: 0, $lte: 10 };
    else if (stockLevel === 'adequate') filter.stock = { $gt: 10 };

    const total = await this.productModel.countDocuments(filter);
    const products = await this.productModel
      .find(filter)
      .select('name nameAr sku stock price status image sales category categoryName')
      .sort({ stock: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      items: products.map((p) => ({
        id: p._id,
        name: p.name,
        nameAr: p.nameAr,
        sku: p.sku,
        stock: p.stock,
        price: p.price,
        status: p.status,
        image: p.image,
        sales: p.sales,
        categoryName: p.categoryName,
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

    // Check low stock
    if (stock <= 5 && stock >= 0) {
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert',
        `${product.name} has only ${stock} units remaining`,
        'stock',
      );
      this.whatsAppService.sendLowStockAlert('admin', product.name, stock);
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
    const lowStock = await this.productModel.countDocuments({ stock: { $gt: 0, $lte: 10 } });

    const totalStockValue = await this.productModel.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$price', '$stock'] } } } },
    ]);

    const totalUnits = await this.productModel.aggregate([
      { $group: { _id: null, units: { $sum: '$stock' } } },
    ]);

    const lowStockItems = await this.productModel
      .find({ stock: { $gt: 0, $lte: 10 }, status: 'active' })
      .select('name nameAr sku stock image')
      .sort({ stock: 1 })
      .limit(10);

    const outOfStockItems = await this.productModel
      .find({ stock: 0, status: 'active' })
      .select('name nameAr sku image')
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
      .select('name nameAr sku stock price status categoryName sales')
      .sort({ name: 1 });

    const data = products.map((p) => ({
      SKU: p.sku,
      Name: p.name,
      'Name (AR)': p.nameAr,
      Category: p.categoryName,
      Stock: p.stock,
      Price: p.price,
      Status: p.status,
      Sales: p.sales,
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 15 }, // SKU
      { wch: 30 }, // Name
      { wch: 30 }, // Name AR
      { wch: 20 }, // Category
      { wch: 10 }, // Stock
      { wch: 10 }, // Price
      { wch: 10 }, // Status
      { wch: 10 }, // Sales
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory');

    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  }

  // Import inventory from Excel
  async importFromExcel(file: Buffer) {
    const workbook = XLSX.read(file, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data: any[] = XLSX.utils.sheet_to_json(worksheet);

    if (!data.length) throw new BadRequestException('Empty file');

    const results = { updated: 0, notFound: 0, errors: 0 };
    const lowStockAlerts: string[] = [];

    for (const row of data) {
      try {
        const sku = row.SKU || row.sku;
        const stock = parseInt(row.Stock || row.stock, 10);

        if (!sku || isNaN(stock)) {
          results.errors++;
          continue;
        }

        const product = await this.productModel.findOneAndUpdate(
          { sku },
          { stock },
          { new: true },
        );

        if (product) {
          results.updated++;
          if (stock <= 5) {
            lowStockAlerts.push(`${product.name} (${stock})`);
          }
        } else {
          results.notFound++;
        }
      } catch {
        results.errors++;
      }
    }

    if (lowStockAlerts.length > 0) {
      await this.notificationsService.notifyAdmins(
        'Low Stock Alert - Excel Import',
        `Low stock after import: ${lowStockAlerts.join(', ')}`,
        'stock',
      );
    }

    return {
      message: `Import completed: ${results.updated} updated, ${results.notFound} not found, ${results.errors} errors`,
      ...results,
      totalRows: data.length,
    };
  }

  // Check and alert low stock items (can be called periodically)
  async checkLowStock(threshold = 5) {
    const lowStockProducts = await this.productModel.find({
      stock: { $gt: 0, $lte: threshold },
      status: 'active',
    });

    if (lowStockProducts.length > 0) {
      const names = lowStockProducts.map((p) => `${p.name} (${p.stock})`).join(', ');
      await this.notificationsService.notifyAdmins(
        'Low Stock Report',
        `${lowStockProducts.length} products below threshold: ${names}`,
        'stock',
      );

      for (const product of lowStockProducts) {
        this.whatsAppService.sendLowStockAlert('admin', product.name, product.stock);
      }
    }

    return {
      lowStockCount: lowStockProducts.length,
      items: lowStockProducts.map((p) => ({
        id: p._id,
        name: p.name,
        sku: p.sku,
        stock: p.stock,
      })),
    };
  }
}
