import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { strictInteger } from '../../common/query-transform.util';
import { Transform } from 'class-transformer';

export class SnapchatAuthStartResponseDto {
  @ApiProperty() authorizationUrl!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}
export class SnapchatCampaignSelectionDto {
  @ApiProperty({
    type: [String],
    description:
      'Snapchat campaign UUIDs returned for this connection. Only selected campaigns contribute to reporting.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  externalCampaignIds!: string[];
}
export class SnapchatMetricsQueryDto {
  @ApiPropertyOptional({
    enum: [1, 7, 30, 90],
    default: 7,
    description: 'Calendar days in the Snapchat ad account timezone.',
  })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @IsIn([1, 7, 30, 90])
  days?: 1 | 7 | 30 | 90 = 7;
}
