import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, Headers, Delete, ForbiddenException } from '@nestjs/common';
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
import { OptionalJwtAuthGuard } from '../auth/optional-jwt.guard';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  // User or guest: Create order. Guests (no JWT) must supply full customer contact
  // details in the body; an account is created for them automatically.
  @Post()
  @UseGuards(OptionalJwtAuthGuard)
  create(@Request() req: any, @Body() dto: CreateOrderDto, @Headers('x-guest-id') guestId?: string) {
    const requestContext = {
      clientIpAddress: req.ip,
      clientUserAgent: req.headers?.['user-agent'],
    };
    if (req.user?._id) {
      return this.ordersService.create(req.user._id, dto, requestContext);
    }
    return this.ordersService.createGuestOrder(dto, guestId, requestContext);
  }

  // User or guest: Create SkipCash session directly from checkout data (order created only after successful payment)
  @Post('skipcash/session')
  @UseGuards(OptionalJwtAuthGuard)
  createSkipCashCheckoutSession(
    @Request() req: any,
    @Body() dto: CreateSkipCashCheckoutSessionDto,
    @Headers('x-guest-id') guestId?: string,
  ) {
    return this.ordersService.createSkipCashCheckoutSession(req.user?._id || null, dto, guestId);
  }

  // Public: Resolve a SkipCash order after payment confirmation
  @Get('skipcash/payment/:paymentId')
  findSkipCashOrderByPaymentId(@Param('paymentId') paymentId: string) {
    return this.ordersService.findSkipCashOrderByPaymentId(paymentId);
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

    // Logged unconditionally, before the key check, so a rejected real SkipCash call
    // still tells us exactly which header/body field they actually use to authenticate —
    // we're currently only guessing at header names.
    console.log('[SkipCash Webhook] Incoming request headers:', JSON.stringify(headers));
    console.log('[SkipCash Webhook] Incoming request body:', JSON.stringify(payload));
    console.log('[SkipCash Webhook] Extracted webhookKey candidate:', webhookKey);

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

  // User: Submit delivery & product review
  @Post(':id/review')
  @UseGuards(AuthGuard('jwt'))
  submitReview(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: any, // SubmitReviewDto
  ) {
    return this.ordersService.submitReview(id, req.user._id, dto);
  }

  // Get order reviews (for admin)
  @Get('reviews/pending')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getPendingReviews(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.ordersService.getPendingReviews({ page, limit });
  }

  // Get all reviews with optional status filtering (admin)
  @Get('reviews')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getAllReviews(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: 'pending' | 'approved',
    @Query('search') search?: string,
  ) {
    return this.ordersService.getAllReviews({ page, limit, status, search });
  }

  // Approve/reject review (admin)
  @Patch('reviews/:reviewId/approve')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  approveReview(
    @Param('reviewId') reviewId: string,
    @Body() dto: { isApproved: boolean; reason?: string },
  ) {
    return this.ordersService.approveReview(reviewId, dto.isApproved, dto.reason);
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
    // Ensure the staff member is assigned to this order before allowing status updates
    return (async () => {
      const order = await this.ordersService.findById(id).catch(() => null);
      if (!order) throw new ForbiddenException('Order not found or inaccessible');
      const assignedStaffId = order.deliveryStaff && (order.deliveryStaff as any).id;
      if (!assignedStaffId || String(assignedStaffId) !== String(req.user._id)) {
        throw new ForbiddenException('You are not assigned to this order');
      }
      return this.ordersService.updateStatus(id, dto, req.user.fullName || 'staff');
    })();
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
  @Roles('admin', 'staff')
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

  // Tracking API: Get order tracking details
  @Get(':id/tracking')
  @UseGuards(AuthGuard('jwt'))
  getTracking(@Request() req: any, @Param('id') id: string) {
    return this.ordersService.getTracking(id, req.user);
  }

  // Reminder API: Resend customer WhatsApp reminder
  @Post(':id/reminder')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  sendReminder(@Request() req: any, @Param('id') id: string) {
    return this.ordersService.sendTrackingReminder(id, req.user?.fullName || req.user?.role || 'system');
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
    // Debug: log incoming payload to help diagnose BadRequest (400)
    try {
      console.log('[AssignDelivery] incoming', { orderId: id, body: dto });
    } catch (e) { /* ignore logging errors */ }
    return this.ordersService.assignDelivery(id, dto);
  }

  // Admin: Delete order
  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  deleteOrder(@Request() req: any, @Param('id') id: string) {
    return this.ordersService.deleteOrder(id, {
      adminId: req.user._id,
      adminName: req.user.fullName || req.user.email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  // Admin: Delete order (POST alias for environments where DELETE may be blocked)
  @Post(':id/delete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  deleteOrderAlias(@Request() req: any, @Param('id') id: string) {
    return this.ordersService.deleteOrder(id, {
      adminId: req.user._id,
      adminName: req.user.fullName || req.user.email,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
  }

  // Admin: Get audit logs for orders (deletion tracking)
  @Get('audit/logs')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getAuditLogs(
    @Query('action') action?: string,
    @Query('orderId') orderId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.ordersService.getAuditLogs({ action, orderId, page, limit });
  }

  // Admin: Get deletion history for specific order
  @Get(':id/audit')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getOrderAudit(@Param('id') id: string) {
    return this.ordersService.getOrderAuditTrail(id);
  }
}
