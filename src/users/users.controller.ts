import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserProfileDto } from './dto/user-profile.dto';

@ApiTags('Users')
@ApiBearerAuth()
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
}
