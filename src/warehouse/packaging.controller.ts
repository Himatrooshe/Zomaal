import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { Response } from 'express';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { OwnedPackagingMaterialResponseDto } from './dto/packaging-response.dto';
import { MediaService } from './media.service';
import { PackagingService } from './packaging.service';

@ApiTags('Warehouse Packaging')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/packaging')
export class PackagingController {
  constructor(
    private readonly packaging: PackagingService,
    private readonly media: MediaService,
  ) {}

  @Get()
  @ApiProduces('application/json')
  @ApiOperation({
    summary: 'List packaging owned by the current merchant',
    description:
      'Populates the Add Product packaging selector. Only active materials credited from delivered Zomaal Shop purchases are returned. available is on-hand minus reserved and damaged. There is intentionally no merchant-facing endpoint for creating ownership.',
  })
  @ApiOkResponse({ type: [OwnedPackagingMaterialResponseDto] })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.packaging.listOwned(user.userId);
  }

  @Get(':id/image')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Owned packaging material ID.',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'Read an owned packaging material image',
    description:
      'Authenticated relative URL returned by packaging responses. The material must be active, owned by the current merchant, and have a catalog image.',
  })
  @ApiOkResponse({
    description: 'Raw packaging image bytes.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description: 'Packaging material ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store-owned active packaging image was not found.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The private Cloud Storage object could not be read.',
    type: ApiErrorDto,
  })
  async image(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ) {
    const objectName = await this.packaging.requireImageObject(user.userId, id);
    return this.media.streamPrivateObject(objectName, response);
  }
}
