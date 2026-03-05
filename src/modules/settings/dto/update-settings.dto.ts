import { IsString, IsBoolean, IsOptional, IsNumber } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  storeEmail?: string;

  @IsOptional()
  @IsString()
  storePhone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  orderNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  stockAlerts?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingEmails?: boolean;

  @IsOptional()
  @IsBoolean()
  twoFactorAuth?: boolean;

  @IsOptional()
  @IsString()
  sessionTimeout?: string;

  @IsOptional()
  @IsBoolean()
  creditCardEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  applePayEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  bankTransferEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  cashOnDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  skipCashEnabled?: boolean;

  @IsOptional()
  @IsString()
  freeShippingThreshold?: string;

  @IsOptional()
  @IsString()
  standardShippingFee?: string;

  @IsOptional()
  @IsBoolean()
  whatsappEnabled?: boolean;

  @IsOptional()
  @IsString()
  whatsappNumber?: string;
}
