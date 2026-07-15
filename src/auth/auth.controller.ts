import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
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
import {
  AuthTokensResponseDto,
  MessageResponseDto,
  TokenPairDto,
} from './dto/auth-response.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP to phone number' })
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
  @ApiOperation({
    summary: 'Verify OTP and log in or register',
    description:
      'Creates the user on first successful verification. Returns a 15-minute access token and a 7-day refresh token.',
  })
  @ApiOkResponse({
    description: 'Returns access token, refresh token, and profile status',
    type: AuthTokensResponseDto,
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
  @ApiOperation({
    summary: 'Rotate refresh token and issue a new token pair',
    description:
      'The supplied refresh token is single-use after rotation. Store the newly returned refresh token.',
  })
  @ApiOkResponse({
    description: 'New access and refresh tokens.',
    type: TokenPairDto,
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
