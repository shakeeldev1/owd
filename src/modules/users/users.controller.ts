import { Controller, Get, Param, Patch, Delete, Body, Query, UseGuards, Request, Post } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @Roles('admin')
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('role') role?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.usersService.findAll({ search, status, role, page, limit });
  }

  @Get('stats')
  @Roles('admin')
  getStats() {
    return this.usersService.getStats();
  }

  @Get(':id')
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() updateData: any) {
    return this.usersService.adminUpdateUser(id, updateData);
  }

  @Patch(':id/toggle-status')
  @Roles('admin')
  toggleStatus(@Param('id') id: string) {
    return this.usersService.toggleStatus(id);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.usersService.deleteUser(id);
  }
}

@Controller('recipients')
@UseGuards(AuthGuard('jwt'))
export class RecipientsController {
  constructor(private usersService: UsersService) {}

  @Get()
  getRecipients(@Request() req: any) {
    return this.usersService.getRecipients(req.user._id);
  }

  @Get(':id')
  getRecipientById(@Param('id') id: string, @Request() req: any) {
    return this.usersService.getRecipientById(req.user._id, id);
  }

  @Post()
  createRecipient(@Request() req: any, @Body() data: any) {
    return this.usersService.createRecipient(req.user._id, data);
  }

  @Patch(':id')
  updateRecipient(@Param('id') id: string, @Request() req: any, @Body() data: any) {
    return this.usersService.updateRecipient(req.user._id, id, data);
  }

  @Delete(':id')
  deleteRecipient(@Param('id') id: string, @Request() req: any) {
    return this.usersService.deleteRecipient(req.user._id, id);
  }

  @Patch(':id/set-primary')
  setPrimaryRecipient(@Param('id') id: string, @Request() req: any) {
    return this.usersService.setPrimaryRecipient(req.user._id, id);
  }
}
