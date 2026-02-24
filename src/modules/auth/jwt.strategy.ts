import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'alfursan-oud-jwt-secret-key-2026-super-secure'),
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const user = await this.authService.validateUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    // Return a plain object with all necessary fields including role
    return {
      _id: user._id,
      id: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      isActive: user.isActive,
      isVerified: user.isVerified,
    };
  }
}
