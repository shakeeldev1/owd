import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateCategoryDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() nameAr: string;
  @IsString() @IsNotEmpty() description: string;
  @IsString() @IsNotEmpty() descriptionAr: string;
  @IsString() @IsOptional() image?: string;
  @IsBoolean() @IsOptional() featured?: boolean;
}

export class UpdateCategoryDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() nameAr?: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() descriptionAr?: string;
  @IsString() @IsOptional() image?: string;
  @IsBoolean() @IsOptional() featured?: boolean;
  @IsBoolean() @IsOptional() isActive?: boolean;
}
