import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SMSService } from './sms.service';

@Controller('api/sms')
export class SMSController {
  constructor(private readonly smsService: SMSService) {}

  @Get('test')
  async testConnection() {
    return await this.smsService.testConnection();
  }

  @Post('send')
  @UseGuards(AuthGuard('jwt'))
  async sendSMS(@Body() body: { to: string; message: string }) {
    const { to, message } = body;
    if (!to || !message) {
      return { success: false, error: 'Phone number and message are required' };
    }
    return await this.smsService.sendSMS(to, message);
  }

  @Post('test-send')
  async testSendSMS(@Body() body: { to: string; message?: string }) {
    const { to, message } = body;
    if (!to) {
      return { success: false, error: 'Phone number is required' };
    }

    const testMessage = message || `Test SMS from Oud Al Zubarah - ${new Date().toISOString()}`;
    return await this.smsService.sendSMS(to, testMessage, { flow: 'test_sms' });
  }

  @Post('send-welcome')
  async sendWelcomeSMS(@Body() body: { customerPhone: string; customerName: string }) {
    const { customerPhone, customerName } = body;
    if (!customerPhone || !customerName) {
      return { success: false, error: 'Phone number and name are required' };
    }
    return await this.smsService.sendWelcomeSMS(customerPhone, customerName);
  }

  @Post('send-order-confirmation')
  async sendOrderConfirmationSMS(
    @Body() body: { customerPhone: string; customerName: string; orderDetails: any },
  ) {
    const { customerPhone, customerName, orderDetails } = body;
    if (!customerPhone || !customerName || !orderDetails) {
      return { success: false, error: 'Phone, name, and order details are required' };
    }
    return await this.smsService.sendOrderConfirmationSMS(customerPhone, customerName, orderDetails);
  }

  @Post('send-order-status-update')
  async sendOrderStatusUpdateSMS(
    @Body() body: { customerPhone: string; customerName: string; orderDetails: any; newStatus: string },
  ) {
    const { customerPhone, customerName, orderDetails, newStatus } = body;
    if (!customerPhone || !customerName || !orderDetails || !newStatus) {
      return { success: false, error: 'Phone, name, order details, and status are required' };
    }
    return await this.smsService.sendOrderStatusUpdateSMS(customerPhone, customerName, orderDetails, newStatus);
  }
}
