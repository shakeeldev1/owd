import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto, ApplyDiscountDto } from './dto/offer.dto';

@Controller('offers')
export class OffersController {
  constructor(private offersService: OffersService) {}

  // Public routes
  @Get()
  findActive() {
    return this.offersService.findActive();
  }

  @Get('featured')
  findFeatured() {
    return this.offersService.findFeatured();
  }

  @Post('apply')
  @UseGuards(AuthGuard('jwt'))
  applyDiscount(@Body() dto: ApplyDiscountDto, @Body('subtotal') subtotal: number) {
    return this.offersService.applyDiscount(dto.code, subtotal);
  }

  // Admin routes
  @Get('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  findAll(@Query() query: any) {
    return this.offersService.findAll(query);
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getStats() {
    return this.offersService.getStats();
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.offersService.findOne(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreateOfferDto) {
    return this.offersService.create(dto);
  }

  @Patch(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offersService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.offersService.remove(id);
  }
}
