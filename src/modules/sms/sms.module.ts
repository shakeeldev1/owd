import { Module } from '@nestjs/common';
import { SMSService } from './sms.service';
import { SMSController } from './sms.controller';

@Module({
  imports: [],
  providers: [SMSService],
  controllers: [SMSController],
  exports: [SMSService],
})
export class SMSModule {}
