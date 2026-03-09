import { Schema, Prop, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SettingsDocument = Settings & Document;

@Schema({ timestamps: true })
export class Settings {
  @Prop({ default: 'Oud Al Zubarah' })
  storeName: string;

  @Prop({ default: 'info@oudalzubarah.qa' })
  storeEmail: string;

  @Prop({ default: '+974 4444 5555' })
  storePhone: string;

  @Prop({ default: 'Pearl, Doha, Qatar' })
  storeAddress: string;

  @Prop({ default: 'Saturday - Thursday: 10AM - 10PM' })
  storeHours: string;

  @Prop({ default: '' })
  instagramUrl: string;

  @Prop({ default: '' })
  twitterUrl: string;

  @Prop({ default: '' })
  facebookUrl: string;

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

  @Prop({ default: true })
  skipCashEnabled: boolean;

  @Prop({ default: '200' })
  freeShippingThreshold: string;

  @Prop({ default: '25' })
  standardShippingFee: string;

  @Prop({ default: true })
  whatsappEnabled: boolean;

  @Prop({ default: '+97433689955' })
  whatsappNumber: string;

  @Prop({ 
    default: null,
    select: false // Never return this in API responses by default
  })
  whatsappApiKey: string;
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);
