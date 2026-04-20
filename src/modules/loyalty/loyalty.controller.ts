import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LoyaltyService } from './loyalty.service';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('loyalty')
export class LoyaltyController {
  constructor(private loyaltyService: LoyaltyService) {}

  // User: Get my loyalty info
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  getMyLoyalty(@Request() req: any) {
    return this.loyaltyService.getUserLoyalty(req.user._id);
  }

  // User: Get my transaction history
  @Get('me/history')
  @UseGuards(AuthGuard('jwt'))
  getMyHistory(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
  ) {
    return this.loyaltyService.getTransactionHistory(req.user._id, { page, limit, type });
  }

  // User: Preview discount from points (without deducting)
  @Post('preview-discount')
  @UseGuards(AuthGuard('jwt'))
  previewDiscount(@Request() req: any, @Body('points') points: number) {
    return this.loyaltyService.previewPointsDiscount(req.user._id, points);
  }

  // User: Redeem points (deducts immediately - used for one-click redemption)
  @Post('redeem')
  @UseGuards(AuthGuard('jwt'))
  redeemPoints(@Request() req: any, @Body('points') points: number) {
    // This endpoint is for backward compatibility or manual redemption
    // For checkout, redemption happens during order creation with auto-discount
    return this.loyaltyService.previewPointsDiscount(req.user._id, points);
  }

  // Admin: Get loyalty stats
  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getStats() {
    return this.loyaltyService.getStats();
  }

  // Admin: Get all users loyalty
  @Get('users')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getAllUsersLoyalty(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('tier') tier?: string,
  ) {
    return this.loyaltyService.getAllUsersLoyalty({ page, limit, tier });
  }

  // Admin: Add bonus points
  @Post('bonus/:userId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  addBonus(
    @Param('userId') userId: string,
    @Body() body: { points: number; description?: string },
  ) {
    return this.loyaltyService.addBonusPoints(userId, body.points, body.description || '');
  }

  // Admin: Adjust points
  @Post('adjust/:userId')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  adjustPoints(
    @Param('userId') userId: string,
    @Body() body: { points: number; description?: string },
  ) {
    return this.loyaltyService.adjustPoints(userId, body.points, body.description || '');
  }

  // Admin/User: Get specific user loyalty
  @Get(':userId')
  @UseGuards(AuthGuard('jwt'))
  getUserLoyalty(@Param('userId') userId: string) {
    return this.loyaltyService.getUserLoyalty(userId);
  }

  // Admin: Get specific user transaction history
  @Get(':userId/history')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getUserHistory(
    @Param('userId') userId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
  ) {
    return this.loyaltyService.getTransactionHistory(userId, { page, limit, type });
  }
}
