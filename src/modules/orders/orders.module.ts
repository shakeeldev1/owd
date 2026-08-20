import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { Order, OrderSchema } from './schemas/order.schema';
import { Review, ReviewSchema } from './schemas/review.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Product, ProductSchema } from '../products/schemas/product.schema';
import { Cart, CartSchema } from '../cart/schemas/cart.schema';
import { Settings, SettingsSchema } from '../settings/settings.schema';
import { Offer, OfferSchema } from '../offers/schemas/offer.schema';
import { SkipCashDraft, SkipCashDraftSchema } from './schemas/skipcash-draft.schema';
import { AuthModule } from '../auth/auth.module';
import { SMSModule } from '../sms/sms.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MetaModule } from '../meta/meta.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Review.name, schema: ReviewSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema },
      { name: Product.name, schema: ProductSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Settings.name, schema: SettingsSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: SkipCashDraft.name, schema: SkipCashDraftSchema },
    ]),
    AuthModule,
    SMSModule,
    LoyaltyModule,
    MetaModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
