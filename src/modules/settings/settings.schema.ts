import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SettingsDocument = Settings & Document;

@Schema({ timestamps: true })
export class Settings {
  @Prop({ default: 'Al Fursan Oud' })
  storeName: string;

  @Prop({ default: 'contact@alfursanoud.com' })
  storeEmail: string;

  @Prop({ default: '+974 4444 5555' })
  storePhone: string;

  @Prop({ default: 'QAR' })
  currency: string;

  @Prop({ default: 'en' })
  language: string;

  @Prop({ default: true })
  emailNotifications: boolean;

  @Prop({ default: true })
  orderNotifications: boolean;

  @Prop({ default: true })
  stockAlerts: boolean;

  @Prop({ default: false })
  marketingEmails: boolean;

  @Prop({ default: false })
  twoFactorAuth: boolean;

  @Prop({ default: '30' })
  sessionTimeout: string;

  @Prop({ default: true })
  creditCardEnabled: boolean;

  @Prop({ default: true })
  applePayEnabled: boolean;

  @Prop({ default: true })
  bankTransferEnabled: boolean;

  @Prop({ default: true })
  cashOnDeliveryEnabled: boolean;

  @Prop({ default: '200' })
  freeShippingThreshold: string;

  @Prop({ default: '25' })
  standardShippingFee: string;

  @Prop({ default: true })
  whatsappEnabled: boolean;

  @Prop({ default: '+974 5555 1234' })
  whatsappNumber: string;

  @Prop({ 
    default: null,
    select: false // Never return this in API responses by default
  })
  whatsappApiKey: string;
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);
