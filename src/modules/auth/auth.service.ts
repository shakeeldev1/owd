import { Injectable, UnauthorizedException, BadRequestException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/schemas/user.schema';
import { SignupDto, LoginDto, VerifyOtpDto, ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { MailService } from './mail.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private mailService: MailService,
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

  async signup(dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const otp = this.generateOtp();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = await this.userModel.create({
      fullName: dto.fullName,
      email,
      phone: dto.phone,
      password: hashedPassword,
      otp,
      otpExpiry,
      isVerified: false,
    });

    // Send OTP email
    await this.mailService.sendOtpEmail(user.email, otp, user.fullName);

    return {
      message: 'Account created. Please verify your email with the OTP sent.',
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

    return {
      message: 'Email verified successfully. You can now login.',
    };
  }

  async resendOtp(email: string) {
    const user = await this.userModel.findOne({ email: email.trim().toLowerCase() });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('Account already verified');
    }

    const otp = this.generateOtp();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await this.mailService.sendOtpEmail(user.email, otp, user.fullName);

    return { message: 'OTP resent successfully' };
  }

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() }).select('+password');
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isVerified) {
      // Resend OTP
      const otp = this.generateOtp();
      user.otp = otp;
      user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await user.save();
      await this.mailService.sendOtpEmail(user.email, otp, user.fullName);

      throw new UnauthorizedException('Account not verified. OTP sent to your email.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }

    const token = this.generateToken(user);

    return {
      message: 'Login successful',
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
      return { message: 'If an account exists with this email, a reset code has been sent.' };
    }

    const otp = this.generateOtp();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    await this.mailService.sendPasswordResetEmail(user.email, otp, user.fullName);

    return { message: 'If an account exists with this email, a reset code has been sent.' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.userModel.findOne({ email: dto.email.trim().toLowerCase() });
    if (!user) {
      throw new BadRequestException('Invalid reset request');
    }

    if (!user.otp || !user.otpExpiry) {
      throw new BadRequestException('No reset code found. Please request a new one.');
    }

    if (new Date() > user.otpExpiry) {
      throw new BadRequestException('Reset code has expired. Please request a new one.');
    }

    if (user.otp !== dto.otp) {
      throw new BadRequestException('Invalid reset code');
    }

    user.password = await bcrypt.hash(dto.newPassword, 12);
    user.otp = null as any;
    user.otpExpiry = null as any;
    await user.save();

    return { message: 'Password reset successfully. You can now login with your new password.' };
  }
}
