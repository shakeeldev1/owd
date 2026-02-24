import { Controller, Get, Patch, Delete, Param, Query, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  getUserNotifications(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.notificationsService.getUserNotifications(req.user._id, page, limit);
  }

  @Get('admin')
  @UseGuards(RolesGuard)
  @Roles('admin', 'staff')
  getAdminNotifications(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.notificationsService.getAdminNotifications(page, limit);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  @Patch('read-all')
  markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user._id);
  }

  @Patch('admin/read-all')
  @UseGuards(RolesGuard)
  @Roles('admin', 'staff')
  markAllAdminAsRead() {
    return this.notificationsService.markAllAdminAsRead();
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.notificationsService.delete(id);
  }
}
