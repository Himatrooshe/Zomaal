import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdsConnectionStatus, AdsPlatform } from '@prisma/client';

export class AdsConnectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AdsPlatform }) platform!: AdsPlatform;
  @ApiProperty({ enum: AdsConnectionStatus }) status!: AdsConnectionStatus;
  @ApiProperty() externalAdvertiserId!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiProperty({ format: 'date-time' }) installedAt!: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) lastSyncedAt!: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncError!: string | null;
}

export class AdsConnectionListDto {
  @ApiProperty({ type: [AdsConnectionDto] })
  data!: AdsConnectionDto[];
}

export class TikTokAuthStartResponseDto {
  @ApiProperty({
    description: 'Single-use authorization URL. Open it in the browser — do not request server-to-server.',
  })
  authorizationUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class TikTokAuthCompleteResponseDto {
  @ApiProperty({ type: [AdsConnectionDto] })
  connections!: AdsConnectionDto[];
}
