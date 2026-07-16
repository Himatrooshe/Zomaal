import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
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
  AuthTokensResponseDto,
  MessageResponseDto,
  TokenPairDto,
} from './dto/auth-response.dto';

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
      'Returns the same 15-minute access token and 7-day refresh token pair as OTP verification.',
  })
  @ApiBody({
    type: LoginDto,
    description: 'Logger phone number and password.',
    examples: {
      logger: {
        summary: 'Configured logger user',
        value: { phone: '+212600000001', password: 'zomaal01@' },
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
      'Requires `Content-Type: application/json`. Requests a six-digit OTP through SMS or WhatsApp. This endpoint does not require an access token and is limited to three requests per phone/channel in ten minutes.',
  })
  @ApiBody({
    type: SendOtpDto,
    examples: {
      sms: {
        summary: 'Send by SMS',
        value: { phone: '+212612345678', channel: 'sms' },
      },
      whatsapp: {
        summary: 'Send by WhatsApp',
        value: { phone: '+212612345678', channel: 'whatsapp' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'OTP request accepted. In development OTP mode no SMS is sent; use DEV_OTP_CODE.',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid phone number, channel, or unexpected request field.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'More than 3 OTP requests in 10 minutes.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'OTP provider is not configured.',
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
}
