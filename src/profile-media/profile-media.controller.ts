import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ProfileMediaService } from './profile-media.service';

// Public on purpose: an <img> tag cannot send a bearer token. Only serves
// files whose names match the server-generated photo-UUID / logo-UUID pattern
// written into ownerPhotoUrl / logoUrl at upload time.
@ApiTags('Profile Media')
@Controller('profile-media')
export class ProfileMediaController {
  constructor(private readonly profileMedia: ProfileMediaService) {}

  @Get('users/:userId/:fileName')
  @ApiExcludeEndpoint()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Serve a profile photo' })
  @ApiOkResponse({ description: 'Raw image bytes.' })
  streamUserPhoto(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('fileName') fileName: string,
    @Res() response: Response,
  ) {
    return this.profileMedia.streamUserPhoto(userId, fileName, response);
  }

  @Get('stores/:storeId/:fileName')
  @ApiExcludeEndpoint()
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Serve a store logo' })
  @ApiOkResponse({ description: 'Raw image bytes.' })
  streamStoreLogo(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('fileName') fileName: string,
    @Res() response: Response,
  ) {
    return this.profileMedia.streamStoreLogo(storeId, fileName, response);
  }
}
