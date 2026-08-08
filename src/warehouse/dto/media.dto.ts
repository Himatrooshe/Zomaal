import { ApiProperty } from '@nestjs/swagger';
import { MediaAssetPurpose } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadWarehouseMediaDto {
  @ApiProperty({
    enum: MediaAssetPurpose,
    description:
      'Attachment role. The role must match how the returned upload ID is used during product creation.',
  })
  @IsEnum(MediaAssetPurpose)
  purpose: MediaAssetPurpose;
}

export class WarehouseMediaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'image/webp' })
  contentType: string;

  @ApiProperty({ example: 182430 })
  sizeBytes: number;

  @ApiProperty({
    example: '/warehouse/media/6ee20108-004a-49c8-bff1-f197b7b67939/content',
  })
  previewPath: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description:
      'Temporary uploads expire after 24 hours. This becomes null after attachment.',
  })
  expiresAt: string | null;
}

export class DeleteWarehouseMediaResponseDto {
  @ApiProperty({ example: true })
  deleted: boolean;
}
