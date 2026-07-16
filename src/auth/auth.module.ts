import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TwilioOtpProvider } from '../providers/twilio-otp.provider';
import { DevelopmentOtpProvider } from '../providers/development-otp.provider';
import { LoggerUserBootstrapService } from './logger-user-bootstrap.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '15m' }, // Access token expiration
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    TwilioOtpProvider,
    DevelopmentOtpProvider,
    LoggerUserBootstrapService,
    {
      provide: 'OtpProvider',
      inject: [ConfigService, TwilioOtpProvider, DevelopmentOtpProvider],
      useFactory: (
        configService: ConfigService,
        twilio: TwilioOtpProvider,
        development: DevelopmentOtpProvider,
      ) =>
        configService.get<string>('DEV_OTP_ENABLED') === 'true'
          ? development
          : twilio,
    },
  ],
})
export class AuthModule {}
