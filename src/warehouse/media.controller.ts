import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  DeleteWarehouseMediaResponseDto,
  UploadWarehouseMediaDto,
  WarehouseMediaResponseDto,
} from './dto/media.dto';
import { MediaService, type WarehouseMediaUploadFile } from './media.service';

@ApiTags('Warehouse Media')
@ApiBearerAuth()
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['purpose', 'image'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['PRODUCT_MAIN', 'PRODUCT_GALLERY', 'VARIANT'],
          description:
            'Must match the later attachment field: mainImageUploadId, galleryImageUploadIds, or variant.imageUploadId.',
        },
        image: {
          type: 'string',
          format: 'binary',
          description:
            'Real JPEG, PNG, or WebP bytes, maximum 5 MiB. Renaming another file type is rejected.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a temporary private warehouse image',
    description:
      'First step of Add Product media handling. Stores the object privately in Cloud Storage and creates a single-use temporary upload valid for 24 hours. Repeat the upload even when reusing the same physical image for another product.',
  })
  @ApiCreatedResponse({ type: WarehouseMediaResponseDto })
  @ApiBadRequestResponse({
    description:
      'Missing file, unsupported/corrupt JPEG/PNG/WebP bytes, invalid purpose, file over 5 MiB, or unexpected form field.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'PRODUCT_IMAGE_BUCKET is missing or the runtime/local ADC identity cannot write to Cloud Storage.',
    type: ApiErrorDto,
  })
  upload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadWarehouseMediaDto,
    @UploadedFile() file?: WarehouseMediaUploadFile,
  ) {
    return this.media.upload(user.userId, dto.purpose, file);
  }

  @Get(':id/content')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned media asset ID.',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'Read a private warehouse image',
    description:
      'Authenticated image URL returned in product/media responses. Mobile clients should send the same bearer token while loading the bytes. The bucket remains private.',
  })
  @ApiOkResponse({
    description: 'Raw image bytes with the original image Content-Type.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({
    description: 'Media ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store-owned media asset was not found.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The private Cloud Storage object could not be read.',
    type: ApiErrorDto,
  })
  content(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ) {
    return this.media.stream(user.userId, id, response);
  }

  @Delete(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Temporary media asset ID.',
  })
  @ApiProduces('application/json')
  @ApiOperation({
    summary: 'Delete an unattached temporary upload',
    description:
      'Cancels an upload before product creation. Missing IDs return deleted=false. Attached product images cannot be deleted through this endpoint.',
  })
  @ApiOkResponse({ type: DeleteWarehouseMediaResponseDto })
  @ApiBadRequestResponse({
    description: 'Media ID is invalid or the image is already attached.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The private Cloud Storage object could not be deleted.',
    type: ApiErrorDto,
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.media.removeTemporary(user.userId, id);
  }
}
