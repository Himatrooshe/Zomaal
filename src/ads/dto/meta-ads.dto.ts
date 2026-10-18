import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
} from 'class-validator';
import { AdsConnectionDto } from './ads-connection.dto';

export class MetaAdsAuthStartResponseDto {
  @ApiProperty({
    description:
      'Single-use Facebook sign-in URL ("Continue with Facebook"). Open it in the browser — do not request it server-to-server.',
  })
  authorizationUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;
}

export class MetaAdsAuthCompleteResponseDto {
  @ApiProperty({
    type: [AdsConnectionDto],
    description:
      'One connection per active Meta ad account the Facebook user can access.',
  })
  connections!: AdsConnectionDto[];
}

export class MetaCampaignDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Meta campaign id (digits).' })
  externalCampaignId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Meta campaign status: ACTIVE or PAUSED.' })
  status!: string;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Campaign objective, e.g. OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT.',
  })
  objective!: string | null;
  @ApiPropertyOptional({
    nullable: true,
    description:
      'Daily budget (else lifetime budget), 2 decimals. null when the budget is set per ad set.',
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

export class MetaCampaignListResponseDto {
  @ApiProperty({ type: [MetaCampaignDto] })
  data!: MetaCampaignDto[];
}

export class SaveMetaCampaignSelectionDto {
  @ApiProperty({
    type: [String],
    description:
      'externalCampaignId values to track. Every other campaign on this connection is un-tracked.',
    example: ['120210000000000000'],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(/^\d{1,30}$/, {
    each: true,
    message: 'each campaign id must be digits',
  })
  externalCampaignIds!: string[];
}

export class SetMetaCampaignStatusDto {
  @ApiProperty({
    enum: ['PAUSED', 'ACTIVE'],
    description: 'PAUSED stops the ads immediately. ACTIVE resumes them.',
  })
  @IsIn(['PAUSED', 'ACTIVE'])
  status!: 'PAUSED' | 'ACTIVE';
}
