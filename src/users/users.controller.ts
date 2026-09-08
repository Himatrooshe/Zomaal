import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { MessageResponseDto } from '../auth/dto/auth-response.dto';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserProfileDto } from './dto/user-profile.dto';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('Users')
@ApiBearerAuth()
@ApiProduces('application/json')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns the user identified by the bearer access token, including the store when one exists. Refresh-token hashes are never returned.',
  })
  @ApiOkResponse({ description: 'Current user profile.', type: UserProfileDto })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.usersService.getProfile(user.userId);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Edit Profile — update name, photo, and/or address',
    description:
      "Updates the fields shown on the Edit Profile screen other than phone (see POST /auth/change-phone/request and /confirm for that). Backs onto the store owner's record or the staff member's record, whichever applies to the current user. At least one field is required.",
  })
  @ApiBody({
    type: UpdateUserProfileDto,
    examples: {
      updateNameAndPhoto: {
        summary: 'Update name and photo',
        value: {
          name: 'Ahmed Alaoui',
          photoUrl: 'https://example.com/avatar.png',
        },
      },
      updateAddress: {
        summary: 'Update address and city',
        value: { address: '123 Rue Hassan II', city: 'Casablanca' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Updated profile.',
    type: UserProfileDto,
  })
  @ApiBadRequestResponse({
    description:
      'No fields supplied, invalid field, or the user has neither a store nor a staff membership to store the profile on yet.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateUserProfileDto,
  ) {
    return this.usersService.updateProfile(user.userId, dto);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change Password',
    description:
      'Sets a new password. `currentPassword` is required and verified when the account already has one; omit it to set a password for the first time (accounts created via OTP have none until now). Revokes the refresh token, signing out every other device.',
  })
  @ApiBody({
    type: ChangePasswordDto,
    examples: {
      changeExisting: {
        summary: 'Change an existing password',
        value: {
          currentPassword: 'OldPass123',
          newPassword: 'NewPass456',
        },
      },
      setFirstPassword: {
        summary: 'Set a password for the first time (OTP-only account)',
        value: { newPassword: 'NewPass456' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Password updated.',
    type: MessageResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Missing current password when one is required, or the new password matches the current one.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing, invalid, expired, or non-access bearer token, or the current password is incorrect.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.usersService.changePassword(user.userId, dto);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete Account',
    description:
      'Permanently deletes the current user. For a store owner this cascades to the store and everything scoped to it; for a staff member it removes their staff membership. Irreversible.',
  })
  @ApiOkResponse({
    description: 'Account deleted.',
    type: MessageResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'User no longer exists.',
    type: ApiErrorDto,
  })
  deleteAccount(@CurrentUser() user: JwtPayload) {
    return this.usersService.deleteAccount(user.userId);
  }
}
