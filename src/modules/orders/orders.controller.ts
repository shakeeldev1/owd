import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, Headers, Delete } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrdersService } from './orders.service';
import {
  CreateOrderDto,
  AdminCreateOrderDto,
  UpdateOrderStatusDto,
  AssignDeliveryDto,
  SubmitFeedbackDto,
  UpdateOrderPaymentDto,
  CreateSkipCashSessionDto,
  CreateSkipCashCheckoutSessionDto,
} from './dto/order.dto';
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

  // User: Create SkipCash session directly from checkout data (order created only after successful payment)
  @Post('skipcash/session')
  @UseGuards(AuthGuard('jwt'))
  createSkipCashCheckoutSession(@Request() req: any, @Body() dto: CreateSkipCashCheckoutSessionDto) {
    return this.ordersService.createSkipCashCheckoutSession(req.user._id, dto);
  }

  // User: Create SkipCash payment session for an order
  @Post(':id/skipcash/session')
  @UseGuards(AuthGuard('jwt'))
  createSkipCashSession(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateSkipCashSessionDto,
  ) {
    return this.ordersService.createSkipCashSession(req.user._id, id, dto);
  }

  // Public: SkipCash webhook callback
  @Post('skipcash/webhook')
  skipCashWebhook(@Body() payload: any, @Headers() headers?: Record<string, string | string[]>) {
    const webhookKey = String(
      headers?.['x-webhook-key']
      || headers?.['webhook-key']
      || headers?.['x-skipcash-webhook-key']
      || headers?.authorization
      || '',
    );

    return this.ordersService.processSkipCashWebhook(payload, webhookKey);
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
    @Query('paymentStatus') paymentStatus?: string,
    @Query('paymentMethod') paymentMethod?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.findAll({ search, status, paymentStatus, paymentMethod, page, limit });
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

  // Admin/Staff: Update payment status and method (COD/POS/card on delivery/cash)
  @Patch(':id/payment')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  updatePayment(@Request() req: any, @Param('id') id: string, @Body() dto: UpdateOrderPaymentDto) {
    return this.ordersService.updatePayment(id, dto, req.user?.fullName || req.user?.role || 'system');
  }

  // Admin: Assign delivery staff
  @Patch(':id/assign')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  assignDelivery(@Param('id') id: string, @Body() dto: AssignDeliveryDto) {
    return this.ordersService.assignDelivery(id, dto);
  }

  // Admin: Delete order
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  deleteOrder(@Param('id') id: string) {
    return this.ordersService.deleteOrder(id);
  }

  // Admin: Delete order (POST alias for environments where DELETE may be blocked)
  @Post(':id/delete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  deleteOrderAlias(@Param('id') id: string) {
    return this.ordersService.deleteOrder(id);
  }
}
