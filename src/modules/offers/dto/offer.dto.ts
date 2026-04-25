import { IsString, IsOptional, IsNumber, IsEnum, IsBoolean, IsDateString } from 'class-validator';

export class CreateOfferDto {
  @IsString()
  title: string;

  @IsString()
  titleAr: string;

  @IsString()
  description: string;

  @IsString()
  descriptionAr: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  subtitleAr?: string;

  @IsOptional()
  @IsString()
  badge?: string;

  @IsOptional()
  @IsString()
  badgeAr?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(['percentage', 'fixed', 'shipping', 'bundle'])
  type?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsNumber()
  minOrder?: number;

  @IsOptional()
  @IsNumber()
  maxDiscount?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  gradient?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  usageLimit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  titleAr?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  descriptionAr?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  subtitleAr?: string;

  @IsOptional()
  @IsString()
  badge?: string;

  @IsOptional()
  @IsString()
  badgeAr?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(['percentage', 'fixed', 'shipping', 'bundle'])
  type?: string;

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsNumber()
  minOrder?: number;

  @IsOptional()
  @IsNumber()
  maxDiscount?: number;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  gradient?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  usageLimit?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;
}

export class ApplyDiscountDto {
  @IsString()
  code: string;

  @IsNumber()
  subtotal: number;
}
