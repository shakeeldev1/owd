import { Controller, Post, Body, UseGuards, Get, Request, Patch } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { SignupDto, LoginDto, VerifyOtpDto, ResendOtpDto, ChangePasswordDto, UpdateProfileDto, UpdateNotificationsDto, ForgotPasswordDto, ResetPasswordDto } from './dto';
import { UsersService } from '../users/users.service';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) {}

  @Post('signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('verify-otp')
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('resend-otp')
  resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto.email);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getProfile(@Request() req: any) {
    return this.usersService.getProfile(req.user._id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile')
  updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(req.user._id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('change-password')
  changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user._id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('notifications')
  updateNotifications(@Request() req: any, @Body() dto: UpdateNotificationsDto) {
    return this.usersService.updateNotifications(req.user._id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  logout() {
    return { message: 'Logged out successfully' };
  }
}
