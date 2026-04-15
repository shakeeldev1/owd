import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, ValidateNested, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ORDER_PAYMENT_METHODS = [
  'cod',
  'skipcash',
  'cash',
  'card_on_delivery',
  'pos_machine',
  'online',
  'visa',
  'mastercard',
  'apple_pay',
  'bank_transfer',
  'local_gateway',
] as const;

export const ORDER_PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'cod'] as const;
export const ORDER_SALES_CHANNELS = ['website', 'delivery', 'store'] as const;

export class OrderItemDto {
  @IsString() @IsOptional() product?: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() nameAr?: string;
  @IsNumber() price!: number;
  @IsNumber() @Min(1) quantity!: number;
  @IsString() @IsOptional() image?: string;
  @IsString() @IsOptional() unit?: string;
  @IsNumber() @IsOptional() pricePerUnit?: number;
}

export class OrderCustomerDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
}

export class CreateOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsString() @IsOptional() shippingAddress?: string;
  @IsEnum(ORDER_PAYMENT_METHODS) @IsOptional() paymentMethod?: string;
  @IsString() @IsOptional() paymentId?: string;
  @IsEnum(ORDER_SALES_CHANNELS) @IsOptional() salesChannel?: string;
  @IsString() @IsOptional() discountCode?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() country?: string;

  @ValidateNested()
  @Type(() => OrderCustomerDto)
  @IsOptional()
  customer?: OrderCustomerDto;
}

export class AdminCreateOrderDto {
  @IsString() @IsNotEmpty() customerName!: string;
  @IsString() @IsNotEmpty() customerPhone!: string;
  @IsString() @IsOptional() customerEmail?: string;
  @IsString() @IsOptional() shippingAddress?: string;
  @IsEnum(ORDER_PAYMENT_METHODS) @IsOptional() paymentMethod?: string;
  @IsEnum(ORDER_PAYMENT_STATUSES) @IsOptional() paymentStatus?: string;
  @IsEnum(ORDER_SALES_CHANNELS) @IsOptional() salesChannel?: string;
  @IsString() @IsOptional() country?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsEnum(['pending', 'confirmed', 'processing', 'ready', 'shipped', 'delivered', 'cancelled'])
  status!: string;

  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() trackingNumber?: string;
}

export class AssignDeliveryDto {
  @IsString() @IsNotEmpty() deliveryStaffId!: string;
}

export class UpdateOrderPaymentDto {
  @IsEnum(ORDER_PAYMENT_STATUSES)
  paymentStatus!: string;

  @IsEnum(ORDER_PAYMENT_METHODS)
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  paymentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class SubmitFeedbackDto {
  @IsNumber() @Min(1) rating!: number;
  @IsString() @IsOptional() comment?: string;
}

export class SubmitReviewDto {
  @IsNumber() @Min(1) @IsOptional() productRating?: number;
  @IsNumber() @Min(1) @IsOptional() deliveryRating?: number;
  @IsString() @IsOptional() productComment?: string;
  @IsString() @IsOptional() deliveryComment?: string;
  @IsArray() @IsOptional() images?: string[];
}

export class CreateSkipCashSessionDto {
  @IsString()
  @IsOptional()
  successUrl?: string;

  @IsString()
  @IsOptional()
  cancelUrl?: string;
}

export class CreateSkipCashCheckoutSessionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @IsString() @IsOptional() shippingAddress?: string;
  @IsString() @IsOptional() discountCode?: string;
  @IsString() @IsOptional() notes?: string;
  @IsString() @IsOptional() country?: string;

  @ValidateNested()
  @Type(() => OrderCustomerDto)
  @IsOptional()
  customer?: OrderCustomerDto;

  @IsString()
  @IsOptional()
  successUrl?: string;

  @IsString()
  @IsOptional()
  cancelUrl?: string;

  @IsEnum(ORDER_PAYMENT_METHODS)
  @IsOptional()
  paymentMethod?: string;
}

export class SkipCashWebhookDto {
  [key: string]: any;
}
