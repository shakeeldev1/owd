import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { ContactService } from './contact.service';
import { CreateContactDto, ReplyContactDto } from './dto/contact.dto';

@Controller('contact')
export class ContactController {
  constructor(private contactService: ContactService) {}

  // Public
  @Post()
  create(@Body() dto: CreateContactDto) {
    return this.contactService.create(dto);
  }

  // Admin routes
  @Get()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  findAll(@Query() query: any) {
    return this.contactService.findAll(query);
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  getStats() {
    return this.contactService.getStats();
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  findOne(@Param('id') id: string) {
    return this.contactService.findOne(id);
  }

  @Patch(':id/read')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  markAsRead(@Param('id') id: string) {
    return this.contactService.markAsRead(id);
  }

  @Patch(':id/reply')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  reply(@Param('id') id: string, @Body() dto: ReplyContactDto) {
    return this.contactService.reply(id, dto);
  }

  @Patch(':id/archive')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  archive(@Param('id') id: string) {
    return this.contactService.archive(id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin')
  remove(@Param('id') id: string) {
    return this.contactService.remove(id);
  }
}
