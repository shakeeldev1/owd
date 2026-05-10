import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settings, SettingsDocument } from './settings.schema';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Settings.name) private settingsModel: Model<SettingsDocument>,
    private configService: ConfigService,
  ) {}

  private getConfigValue(keys: string[], fallback: string): string {
    for (const key of keys) {
      const value = this.configService.get<string>(key, '');
      if (value && String(value).trim()) {
        return String(value).trim();
      }
    }

    return fallback;
  }

  async getSettings() {
    let settings = await this.settingsModel.findOne().lean();

    if (!settings) {
      settings = await this.settingsModel.create({});
    }

    // Never return the API key
    const { whatsappApiKey, ...safe } = settings as any;
    return safe;
  }

  async updateSettings(updateData: Partial<Settings>) {
    const settings = await this.settingsModel.findOne();

    if (!settings) {
      const newSettings = await this.settingsModel.create(updateData);
      const obj = newSettings.toObject();
      const { whatsappApiKey, ...safe } = obj;
      return safe;
    }

    // Exclude API key from the update (use env variable instead)
    const { whatsappApiKey, ...safeData } = updateData as any;

    Object.assign(settings, safeData);
    await settings.save();

    const returned = settings.toObject();
    const { whatsappApiKey: _, ...safeReturned } = returned as any;

    return safeReturned;
  }

  async getWhatsAppApiKey(): Promise<string> {
    // Return from environment variable for security
    return this.getConfigValue(['WHATSAPP_API_KEY', 'MESSAGING_API_KEY'], '');
  }
}
