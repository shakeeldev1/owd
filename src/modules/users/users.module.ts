import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersService } from './users.service';
import { UsersController, RecipientsController } from './users.controller';
import { User, UserSchema } from './schemas/user.schema';
import { Recipient, RecipientSchema } from './schemas/recipient.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Recipient.name, schema: RecipientSchema },
    ]),
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersController, RecipientsController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
