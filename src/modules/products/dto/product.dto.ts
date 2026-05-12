import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsEnum, IsArray, IsDate } from 'class-validator';

export class CreateProductDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsString() @IsNotEmpty()
  nameAr: string;

  @IsString() @IsNotEmpty()
  description: string;

  @IsString() @IsNotEmpty()
  descriptionAr: string;

  @IsNumber()
  price: number;

  @IsNumber() @IsOptional()
  originalPrice?: number;

  @IsString() @IsOptional()
  image?: string;

  @IsArray() @IsOptional()
  images?: string[];

  @IsString() @IsNotEmpty()
  sku: string;

  @IsString() @IsOptional()
  itemCode?: string;

  @IsString() @IsOptional()
  unit?: string;

  @IsEnum(['gram-based', 'piece-based']) @IsOptional()
  inventoryType?: string;

  @IsNumber() @IsOptional()
  pricePerTola?: number;

  @IsNumber() @IsOptional()
  pricePerQuarterTola?: number;

  @IsNumber() @IsOptional()
  pricePerPiece?: number;

  @IsNumber() @IsOptional()
  lowStockThreshold?: number;

  @IsString() @IsOptional()
  category?: string;

  @IsString() @IsOptional()
  categoryName?: string;

  @IsString() @IsOptional()
  badge?: string;

  @IsString() @IsOptional()
  badgeAr?: string;

  @IsBoolean() @IsOptional()
  isNew?: boolean;

  @IsBoolean() @IsOptional()
  isNewArrival?: boolean;

  @IsBoolean() @IsOptional()
  isBestseller?: boolean;

  @IsBoolean() @IsOptional()
  isLimitedEdition?: boolean;

  @IsBoolean() @IsOptional()
  isFeatured?: boolean;

  @IsNumber() @IsOptional()
  stock?: number;

  @IsEnum(['active', 'draft', 'archived']) @IsOptional()
  status?: string;

  @IsNumber() @IsOptional()
  weight?: number;

  @IsBoolean() @IsOptional()
  isOnOffer?: boolean;

  @IsNumber() @IsOptional()
  offerPrice?: number;

  @IsNumber() @IsOptional()
  offerDiscountPercent?: number;

  @IsOptional()
  offerStartDate?: Date | null;

  @IsOptional()
  offerEndDate?: Date | null;
}

export class UpdateProductDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() nameAr?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() descriptionAr?: string;
  @IsNumber() @IsOptional() price?: number;
  @IsNumber() @IsOptional() originalPrice?: number;
  @IsString() @IsOptional() image?: string;
  @IsArray() @IsOptional() images?: string[];
  @IsString() @IsOptional() sku?: string;
  @IsString() @IsOptional() itemCode?: string;
  @IsString() @IsOptional() unit?: string;
  @IsEnum(['gram-based', 'piece-based']) @IsOptional() inventoryType?: string;
  @IsNumber() @IsOptional() pricePerTola?: number;
  @IsNumber() @IsOptional() pricePerQuarterTola?: number;
  @IsNumber() @IsOptional() pricePerPiece?: number;
  @IsNumber() @IsOptional() lowStockThreshold?: number;
  @IsString() @IsOptional() category?: string;
  @IsString() @IsOptional() categoryName?: string;
  @IsString() @IsOptional() badge?: string;
  @IsString() @IsOptional() badgeAr?: string;
  @IsBoolean() @IsOptional() isNew?: boolean;
  @IsBoolean() @IsOptional() isNewArrival?: boolean;
  @IsBoolean() @IsOptional() isBestseller?: boolean;
  @IsBoolean() @IsOptional() isLimitedEdition?: boolean;
  @IsBoolean() @IsOptional() isFeatured?: boolean;
  @IsNumber() @IsOptional() stock?: number;
  @IsEnum(['active', 'draft', 'archived']) @IsOptional() status?: string;
  @IsNumber() @IsOptional() weight?: number;
  @IsBoolean() @IsOptional() isOnOffer?: boolean;
  @IsNumber() @IsOptional() offerPrice?: number;
  @IsNumber() @IsOptional() offerDiscountPercent?: number;
  @IsOptional() offerStartDate?: Date | null;
  @IsOptional() offerEndDate?: Date | null;
}

export class AddProductReviewDto {
  @IsNumber()
  rating: number;

  @IsString()
  @IsOptional()
  comment?: string;
}
