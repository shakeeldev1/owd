import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, Res, UseInterceptors, UploadedFile } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, AddProductReviewDto } from './dto/product.dto';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

  // Public routes
  @Get()
  findAll(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('section') section?: string,
    @Query('minPrice') minPrice?: number,
    @Query('maxPrice') maxPrice?: number,
    @Query('sort') sort?: string,
    @Query('filter') filter?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('featured') featured?: boolean,
  ) {
    return this.productsService.findAll({
      search, category, section, minPrice, maxPrice, sort, filter, page, limit, featured,
    });
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  getStats() {
    return this.productsService.getStats();
  }

  @Get('top')
  getTopProducts(@Query('limit') limit?: number) {
    return this.productsService.getTopProducts(limit);
  }

  @Get('top-reviews')
  getTopReviews(@Query('limit') limit?: number) {
    return this.productsService.getTopReviews(limit);
  }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Get('slug/:slug/related')
  getRelated(@Param('slug') slug: string, @Query('limit') limit?: number) {
    return this.productsService.getRelated(slug, limit);
  }

  @Get('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  adminFindAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.productsService.adminFindAll({ search, status, page, limit });
  }

  @Get('admin/export')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  exportToExcel(@Res() res: any) {
    return this.productsService.exportToExcel(res);
  }

  @Get('admin/template')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  getTemplate(@Res() res: any) {
    return this.productsService.generateTemplateExcel(res);
  }

  @Post('admin/import')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  @UseInterceptors(FileInterceptor('file'))
  importFromExcel(@UploadedFile() file: Express.Multer.File) {
    return this.productsService.importFromExcel(file);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.productsService.findById(id);
  }

  @Post(':id/reviews')
  @UseGuards(AuthGuard('jwt'))
  addReview(@Param('id') id: string, @Request() req: any, @Body() dto: AddProductReviewDto) {
    return this.productsService.addReview(id, req.user, dto);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}
