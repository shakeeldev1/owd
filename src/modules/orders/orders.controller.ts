import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrdersService } from './orders.service';
import { CreateOrderDto, AdminCreateOrderDto, UpdateOrderStatusDto, AssignDeliveryDto, SubmitFeedbackDto } from './dto/order.dto';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  // User: Create order
  @Post()
  @UseGuards(AuthGuard('jwt'))
  create(@Request() req: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user._id, dto);
  }

  // User: My orders
  @Get('my')
  @UseGuards(AuthGuard('jwt'))
  myOrders(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.findUserOrders(req.user._id, { status, page, limit });
  }

  // User: Submit feedback
  @Post(':id/feedback')
  @UseGuards(AuthGuard('jwt'))
  submitFeedback(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: SubmitFeedbackDto,
  ) {
    return this.ordersService.submitFeedback(id, req.user._id, dto);
  }

  // Staff: My assigned orders
  @Get('staff/assigned')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('staff')
  getStaffOrders(
    @Request() req: any,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.getStaffOrders(req.user._id, { status, page, limit });
  }

  // Staff: Update assigned order status (limited to shipped/delivered)
  @Patch('staff/:id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('staff')
  staffUpdateStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(id, dto, req.user.fullName || 'staff');
  }

  // Admin: All orders
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.findAll({ search, status, page, limit });
  }

  // Admin: Stats
  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getStats() {
    return this.ordersService.getStats();
  }

  // Admin: Recent orders
  @Get('recent')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getRecent(@Query('limit') limit?: number) {
    return this.ordersService.getRecentOrders(limit);
  }

  // Get single order
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  findById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  // Admin: Create order
  @Post('admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  adminCreate(@Body() dto: AdminCreateOrderDto) {
    return this.ordersService.adminCreate(dto);
  }

  // Admin: Update status
  @Patch(':id/status')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto);
  }

  // Admin: Assign delivery staff
  @Patch(':id/assign')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  assignDelivery(@Param('id') id: string, @Body() dto: AssignDeliveryDto) {
    return this.ordersService.assignDelivery(id, dto);
  }
}
