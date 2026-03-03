import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, ValidateNested, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export const ORDER_PAYMENT_METHODS = [
  'cod',
  'cash',
  'card_on_delivery',
  'pos_machine',
  'online',
  'visa',
  'mastercard',
  'apple_pay',
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

  @IsString() @IsNotEmpty() shippingAddress!: string;
  @IsEnum(ORDER_PAYMENT_METHODS) @IsOptional() paymentMethod?: string;
  @IsString() @IsOptional() paymentId?: string;
  @IsEnum(ORDER_SALES_CHANNELS) @IsOptional() salesChannel?: string;
  @IsString() @IsOptional() discountCode?: string;
  @IsString() @IsOptional() notes?: string;

  @ValidateNested()
  @Type(() => OrderCustomerDto)
  @IsOptional()
  customer?: OrderCustomerDto;
}

export class AdminCreateOrderDto {
  @IsString() @IsNotEmpty() customerName!: string;
  @IsString() @IsOptional() customerEmail?: string;
  @IsString() @IsOptional() customerPhone?: string;
  @IsString() @IsNotEmpty() shippingAddress!: string;
  @IsEnum(ORDER_PAYMENT_METHODS) @IsOptional() paymentMethod?: string;
  @IsEnum(ORDER_PAYMENT_STATUSES) @IsOptional() paymentStatus?: string;
  @IsEnum(ORDER_SALES_CHANNELS) @IsOptional() salesChannel?: string;

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
