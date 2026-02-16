import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('admin')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('dashboard')
  getDashboard() {
    return this.analyticsService.getDashboard();
  }

  @Get('revenue')
  getRevenue(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.analyticsService.getRevenueByDateRange(startDate, endDate);
  }

  @Get('customers')
  getCustomerStats() {
    return this.analyticsService.getCustomerStats();
  }
}
