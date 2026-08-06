import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class MetaCapiUserDataDto {
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() externalId?: string;
}

export class TrackCapiEventDto {
  @IsIn(['ViewContent', 'AddToCart', 'InitiateCheckout'])
  eventName!: string;

  @IsString() @IsNotEmpty() eventId!: string;

  @IsString() @IsOptional() eventSourceUrl?: string;

  @IsObject() @IsOptional() params?: Record<string, any>;

  @IsObject() @IsOptional() userData?: MetaCapiUserDataDto;
}
