import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';
import { Settings } from './settings.schema';
import { RolesGuard, Roles } from '../auth/roles.guard';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getSettings() {
    try {
      const settings = await this.settingsService.getSettings();
      return {
        success: true,
        data: settings,
        message: 'Settings retrieved successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to retrieve settings',
      };
    }
  }

  @Patch()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('admin', 'staff')
  @HttpCode(HttpStatus.OK)
  async updateSettings(@Body() updateSettingsDto: Partial<Settings>) {
    try {
      const result = await this.settingsService.updateSettings(updateSettingsDto);
      return {
        success: true,
        data: result,
        message: 'Settings updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Failed to update settings',
      };
    }
  }
}
