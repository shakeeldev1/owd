import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/schemas/user.schema';
import { SignupDto, LoginDto, VerifyOtpDto, ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { MailService } from './mail.service';
import { SMSService } from '../sms/sms.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { normalizePhone } from '../../utils/phone';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private mailService: MailService,
    private smsService: SMSService,
    private whatsAppService: WhatsAppService,
  ) {}

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateToken(user: UserDocument): string {
    return this.jwtService.sign({
      sub: user._id,
      email: user.email,
      role: user.role,
    });
  }

  private async sendVerificationOtpEmail(user: Pick<UserDocument, 'email' | 'fullName'>, otp: string): Promise<boolean> {
    try {
      await this.mailService.sendOtpEmail(user.email, otp, user.fullName);
      return true;
    } catch (error: any) {
      console.error('❌ Verification OTP email sending failed:', error?.message || error);
      return false;
    }
  }

  private async sendVerificationOtpWhatsApp(fullName: string, phone: string, otp: string): Promise<boolean> {
    try {
      const otpMessage = `مرحباً ${fullName}\n\nرمز التحقق الخاص بك: ${otp}\nصالح لمدة 10 دقائق\n\nلا تشارك هذا الرمز مع أحد`;
      return await this.whatsAppService.sendMessage(phone, otpMessage);
    } catch (error: any) {
      console.error('❌ Verification OTP WhatsApp sending failed:', error?.message || error);
      return false;
    }
  }

  async signup(dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new ConflictException('البريد الإلكتروني مسجل بالفعل');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const otp = this.generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const normalizedPhone = normalizePhone(dto.phone);

    const user = await this.userModel.create({
      fullName: dto.fullName,
      email,
      phone: normalizedPhone,
      password: hashedPassword,
      otp,
      otpExpiry,
      isVerified: false,
    });

    // Send verification OTP through both email and WhatsApp.
    const otpEmailSent = await this.sendVerificationOtpEmail(user, otp);
    const otpWhatsAppSent = await this.sendVerificationOtpWhatsApp(user.fullName, normalizedPhone, otp);

    if (!otpEmailSent) {
      console.warn('⚠️ Email OTP delivery failed for new signup:', email);
    }
    if (!otpWhatsAppSent) {
      console.warn('⚠️ WhatsApp OTP delivery failed for new signup:', email);
    }

    return {
      message: 'تم إنشاء الحساب. يرجى التحقق برمز OTP المرسل إلى بريدك الإلكتروني ورقم الواتساب.',
      email: user.email,
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('Account already verified');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException('No OTP found. Please request a new one.');
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException('OTP has expired. Please request a new one.');
    }

    if (user.otp !== dto.otp) {
      throw new BadRequestException('Invalid OTP');
    }

    user.isVerified = true;
    user.otp = null as any;
    user.otpExpiry = null as any;
    await user.save();

    // Send welcome SMS
    if (user.phone) {
      const smsSent = await this.smsService.sendWelcomeSMS(user.phone, user.fullName);
      if (!smsSent.success) {
        console.warn('⚠️ Welcome SMS failed:', smsSent.error);
      }
    }

    return {
      message: 'Email verified successfully. You can now login.',
    };
  }

  async resendOtp(email: string) {
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      throw new BadRequestException('المستخدم غير موجود');
    }

    if (user.isVerified) {
      throw new BadRequestException('الحساب مُعطّل بالفعل');
    }

    const otp = this.generateOtp();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    const otpEmailSent = await this.sendVerificationOtpEmail(user, otp);
    const otpWhatsAppSent = await this.sendVerificationOtpWhatsApp(user.fullName, user.phone, otp);

    if (!otpEmailSent) {
      console.warn('⚠️ Email OTP resend failed for:', email);
    }
    if (!otpWhatsAppSent) {
      console.warn('⚠️ WhatsApp OTP resend failed for:', email);
    }

    return { message: 'تم إعادة إرسال OTP إلى بريدك الإلكتروني ورقم الواتساب' };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() }).select('+password');
    if (!user) {
      throw new UnauthorizedException('بريد إلكتروني أو كلمة مرور غير صحيحة');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('بريد إلكتروني أو كلمة مرور غير صحيحة');
    }

    if (!user.isVerified) {
      // Resend verification OTP via email
      const otp = this.generateOtp();
      user.otp = otp;
      user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();

      const otpEmailSent = await this.sendVerificationOtpEmail(user, otp);
      const otpWhatsAppSent = await this.sendVerificationOtpWhatsApp(user.fullName, user.phone, otp);

      if (!otpEmailSent) {
        console.warn('⚠️ Email OTP delivery failed during login for:', user.email);
      }
      if (!otpWhatsAppSent) {
        console.warn('⚠️ WhatsApp OTP delivery failed during login for:', user.email);
      }

      throw new UnauthorizedException('الحساب لم يتم التحقق منه. تم إرسال OTP إلى بريدك الإلكتروني ورقم الواتساب.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('الحساب معطّل');
    }

    const token = this.generateToken(user);

    return {
      message: 'تم تسجيل الدخول بنجاح',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        address: user.address,
        role: user.role,
        loyaltyTier: user.loyaltyTier,
        notifications: user.notifications,
        createdAt: (user as any).createdAt,
      },
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId).select('+password');
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    user.password = await bcrypt.hash(dto.newPassword, 12);
    await user.save();

    return { message: 'Password changed successfully' };
  }

  async validateUser(userId: string): Promise<UserDocument> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or deactivated');
    }
    return user;
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      return { message: 'إذا كان هناك حساب بهذا البريد الإلكتروني، فسيتم إرسال رمز إعادة التعيين.' };
    }

    const otp = this.generateOtp();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    // Send via WhatsApp (Arabic)
    const resetMessage = `مرحباً ${user.fullName}\n\nرمز إعادة تعيين كلمة المرور الخاص بك: ${otp}\nصالح لمدة 10 دقائق\n\nلا تشارك هذا الرمز مع أحد`;
    const whatsappSent = await this.whatsAppService.sendMessage(user.phone, resetMessage).catch(() => false);
    
    if (!whatsappSent) {
      console.warn('⚠️ WhatsApp password reset code failed for:', user.email);
    }

    return { message: 'إذا كان هناك حساب بهذا البريد الإلكتروني، فسيتم إرسال رمز إعادة التعيين.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() });
    if (!user) {
      throw new BadRequestException('طلب إعادة تعيين غير صالح');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException('لا يوجد رمز إعادة تعيين. يرجى طلب واحد جديد.');
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException('انتهت صلاحية رمز إعادة التعيين. يرجى طلب واحد جديد.');
    }

    if (user.otp !== dto.otp) {
      throw new BadRequestException('رمز إعادة التعيين غير صحيح');
    }

    user.password = await bcrypt.hash(dto.newPassword, 12);
    user.otp = null as any;
    user.otpExpiry = null as any;
    await user.save();

    return { message: 'تم إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول برمز المرور الجديد.' };
  }
}
