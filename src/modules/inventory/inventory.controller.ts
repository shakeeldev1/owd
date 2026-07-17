import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { InventoryService } from './inventory.service';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  // Get inventory list
  @Get()
  getInventory(
    @Query('search') search?: string,
    @Query('stockLevel') stockLevel?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.inventoryService.getInventory({ search, stockLevel, page, limit });
  }

  // Get inventory stats
  @Get('stats')
  getStats() {
    return this.inventoryService.getStats();
  }

  // Check low stock
  @Get('low-stock')
  checkLowStock(@Query('threshold') threshold?: number) {
    return this.inventoryService.checkLowStock(threshold);
  }

  // Export to Excel
  @Get('export')
  async exportExcel(@Res() res: Response) {
    const buffer = await this.inventoryService.exportToExcel();
    const date = new Date().toISOString().split('T')[0];
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=inventory-${date}.xlsx`,
    );
    res.send(buffer);
  }

  // Import from Excel
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
  async importExcel(@UploadedFile() file: any) {
    if (!file) {
      return { message: 'No file provided' };
    }
    return this.inventoryService.importFromExcel(file.buffer);
  }

  // Update single product stock
  @Patch(':productId/stock')
  updateStock(
    @Param('productId') productId: string,
    @Body('stock') stock: number,
  ) {
    return this.inventoryService.updateStock(productId, stock);
  }

  // Bulk update stock
  @Patch('bulk')
  bulkUpdateStock(@Body() body: { updates: { productId: string; stock: number }[] }) {
    return this.inventoryService.bulkUpdateStock(body.updates);
  }
}
