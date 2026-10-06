import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
} from 'class-validator';
import { AdsConnectionDto } from './ads-connection.dto';

export class GoogleAdsAuthStartResponseDto {
  @ApiProperty({
    description:
      'Single-use Google sign-in URL ("Continue with Google"). Open it in the browser — do not request it server-to-server.',
  })
  authorizationUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class GoogleAdsAuthCompleteResponseDto {
  @ApiProperty({
    type: [AdsConnectionDto],
    description:
      'One connection per Google Ads advertiser account the user can access.',
  })
  connections!: AdsConnectionDto[];
}

export class GoogleCampaignDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Google Ads campaign id (digits).' })
  externalCampaignId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Google campaign status: ENABLED or PAUSED.' })
  status!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Campaign type, e.g. SEARCH, DISPLAY, PERFORMANCE_MAX, VIDEO, SHOPPING.',
  })
  objective!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Daily budget, 2 decimals.',
  })
  budget!: string | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) startDate!:
    | string
    | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) endDate!:
    | string
    | null;
  @ApiProperty({
    description:
      'Selected on "Select Campaigns" — only tracked campaigns are synced.',
  })
  tracked!: boolean;
}

export class GoogleCampaignListResponseDto {
  @ApiProperty({ type: [GoogleCampaignDto] })
  data!: GoogleCampaignDto[];
}

export class SaveGoogleCampaignSelectionDto {
  @ApiProperty({
    type: [String],
    description:
      'externalCampaignId values to track. Every other campaign on this connection is un-tracked.',
    example: ['12345678901'],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(/^\d{1,20}$/, {
    each: true,
    message: 'each campaign id must be digits',
  })
  externalCampaignIds!: string[];
}

export class SetGoogleCampaignStatusDto {
  @ApiProperty({
    enum: ['PAUSED', 'ENABLED'],
    description: 'PAUSED stops the ads immediately.',
  })
  @IsIn(['PAUSED', 'ENABLED'])
  status!: 'PAUSED' | 'ENABLED';
}
