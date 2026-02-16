import { IsString, IsNotEmpty, IsNumber, IsOptional, Min } from 'class-validator';

export class AddToCartDto {
  @IsString() @IsNotEmpty() productId: string;
  @IsNumber() @Min(1) quantity: number;
}

export class UpdateCartItemDto {
  @IsNumber() @Min(1) quantity: number;
}

export class AddToWishlistDto {
  @IsString() @IsNotEmpty() productId: string;
}
