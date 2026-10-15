import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordRequestDto,
  ResetPasswordDto,
} from './dto/forgot-password.dto';
import {
  AuthTokensResponseDto,
  MessageResponseDto,
  PasswordResetTokenResponseDto,
  TokenPairDto,
} from './dto/auth-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import { AllowWhenLocked } from '../billing/billing.decorators';

const tokenResponseHeaders = {
  'Cache-Control': {
    description: 'Prevents access and refresh tokens from being cached.',
    schema: { type: 'string', example: 'no-store' },
  },
  Pragma: {
    description: 'Legacy cache prevention for token responses.',
    schema: { type: 'string', example: 'no-cache' },
  },
};

@ApiTags('Auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@AllowWhenLocked()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Log in with phone number and password',
    description:
      'Merchants and staff use the same login. Returns a 15-minute access token and a refresh token that lasts 7 days, or 30 days with `rememberMe: true`.',
  })
  @ApiBody({
    type: LoginDto,
    description: 'Phone number and password.',
    examples: {
      default: {
        summary: 'Log in',
        value: { phone: '+212600000001', password: 'your-password' },
      },
      rememberMe: {
        summary: 'Log in with "Remember me"',
        value: {
          phone: '+212600000001',
          password: 'your-password',
          rememberMe: true,
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Authentication succeeded.',
    type: AuthTokensResponseDto,
    headers: tokenResponseHeaders,
  })
  @ApiBadRequestResponse({
    description: 'Invalid or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid phone number or password.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 login attempts in 15 minutes.',
    type: ApiErrorDto,
  })
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send OTP to phone number',
    description:
      'Requires `Content-Type: application/json`. Requests a six-digit OTP by SMS (the only channel for now; `channel` may be omitted). This endpoint does not require an access token and is limited to three requests per phone in ten minutes.',
  })
  @ApiBody({
    type: SendOtpDto,
    examples: {
      sms: {
        summary: 'Send by SMS',
        value: { phone: '+212612345678' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OTP request accepted. In development OTP mode no SMS is sent; use DEV_OTP_CODE.',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid phone number, a channel other than sms, a landline, a country SMS cannot be sent to, or unexpected request field. Show `message` to the user.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description:
      'More than 3 OTP requests in 10 minutes, or the SMS provider limit for this number was reached.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'OTP provider is not configured or temporarily unavailable. Retry later.',
    type: ApiErrorDto,
  })
  sendOtp(@Body() sendOtpDto: SendOtpDto) {
    return this.authService.sendOtp(sendOtpDto);
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Verify OTP and log in or register',
    description:
      'Creates the user on first successful verification. Returns a 15-minute access token and a 7-day refresh token.',
  })
  @ApiBody({
    type: VerifyOtpDto,
    examples: {
      default: {
        summary: 'Verify a six-digit OTP',
        value: { phone: '+212612345678', otp: '123456' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Returns access token, refresh token, and profile status',
    type: AuthTokensResponseDto,
    headers: tokenResponseHeaders,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input or invalid/expired OTP.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 verification attempts in 10 minutes.',
    type: ApiErrorDto,
  })
  verifyOtp(@Body() verifyOtpDto: VerifyOtpDto) {
    return this.authService.verifyOtp(verifyOtpDto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Rotate refresh token and issue a new token pair',
    description:
      'The supplied refresh token is single-use after rotation. Store the newly returned refresh token.',
  })
  @ApiBody({
    type: RefreshTokenDto,
    description:
      'Send the refresh token in the JSON body, not in the Authorization header.',
    examples: {
      default: {
        summary: 'Rotate the refresh token',
        value: {
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'New access and refresh tokens.',
    type: TokenPairDto,
    headers: tokenResponseHeaders,
  })
  @ApiBadRequestResponse({
    description: 'Missing, empty, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Refresh token is invalid, expired, revoked, or not a refresh token.',
    type: ApiErrorDto,
  })
  refreshTokens(@Body() refreshDto: RefreshTokenDto) {
    return this.authService.refreshTokens(refreshDto.refreshToken);
  }

  @Post('forgot-password/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forgot password — send an OTP',
    description:
      'Step 1 of 3. Sends an SMS OTP if the number has an account. Always returns the same message, so it cannot be used to check which numbers are registered. Limited to three requests per phone in ten minutes.',
  })
  @ApiBody({
    type: ForgotPasswordRequestDto,
    examples: {
      default: { summary: 'Request', value: { phone: '+212612345678' } },
    },
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid phone number or unexpected field.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 3 requests in 10 minutes.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'OTP provider is not configured.',
    type: ApiErrorDto,
  })
  requestPasswordReset(@Body() dto: ForgotPasswordRequestDto) {
    return this.authService.requestPasswordReset(dto.phone);
  }

  @Post('forgot-password/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Forgot password — verify the OTP',
    description:
      'Step 2 of 3. Returns a reset token valid for 10 minutes. Does not log the user in.',
  })
  @ApiBody({
    type: VerifyOtpDto,
    examples: {
      default: {
        summary: 'Verify',
        value: { phone: '+212612345678', otp: '123456' },
      },
    },
  })
  @ApiOkResponse({
    type: PasswordResetTokenResponseDto,
    headers: tokenResponseHeaders,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input, or invalid/expired OTP.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 attempts in 10 minutes.',
    type: ApiErrorDto,
  })
  verifyPasswordReset(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyPasswordReset(dto);
  }

  @Post('forgot-password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forgot password — set the new password',
    description:
      'Step 3 of 3. Sets the new password and signs the account out on every device. The reset token works once. Then log in with POST /auth/login.',
  })
  @ApiBody({
    type: ResetPasswordDto,
    examples: {
      default: {
        summary: 'Reset',
        value: {
          resetToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          newPassword: 'your-new-password',
        },
      },
    },
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({
    description: 'Password shorter than 8 characters or unexpected field.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Reset token is invalid, expired, or already used.',
    type: ApiErrorDto,
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Log out the current device',
    description:
      'Revokes the refresh token, ending the session. The current access token remains valid until its normal 15-minute expiry.',
  })
  @ApiOkResponse({ description: 'Logged out.', type: MessageResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  logout(@CurrentUser() user: JwtPayload) {
    return this.authService.logout(user.userId);
  }

  @Post('change-phone/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Edit Profile — request a phone number change',
    description:
      'Sends an OTP to the new phone number. The number must differ from the current one and not already belong to another account. Limited to three requests per user in ten minutes.',
  })
  @ApiBody({
    type: SendOtpDto,
    examples: {
      sms: {
        summary: 'Send by SMS',
        value: { phone: '+212612345678' },
      },
    },
  })
  @ApiOkResponse({
    description: 'OTP sent to the new phone number.',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid phone/channel, or the new number matches the current one.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The phone number already belongs to another account.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 3 change requests in 10 minutes.',
    type: ApiErrorDto,
  })
  requestPhoneChange(@CurrentUser() user: JwtPayload, @Body() dto: SendOtpDto) {
    return this.authService.requestPhoneChange(user.userId, dto);
  }

  @Post('change-phone/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Edit Profile — confirm a phone number change',
    description:
      'Verifies the OTP sent to the new phone number and swaps it in. Reissues the access/refresh token pair since the old ones carry the previous number — store the newly returned tokens.',
  })
  @ApiBody({
    type: VerifyOtpDto,
    examples: {
      default: {
        summary: 'Confirm with the six-digit OTP',
        value: { phone: '+212612345678', otp: '123456' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Phone number updated. New access and refresh tokens.',
    type: AuthTokensResponseDto,
    headers: tokenResponseHeaders,
  })
  @ApiBadRequestResponse({
    description: 'Invalid input or invalid/expired OTP.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'The phone number was claimed by another account between request and confirm.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 5 confirmation attempts in 10 minutes.',
    type: ApiErrorDto,
  })
  confirmPhoneChange(
    @CurrentUser() user: JwtPayload,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.authService.confirmPhoneChange(user.userId, dto);
  }
}
