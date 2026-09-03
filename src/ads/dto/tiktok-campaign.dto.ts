import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class TikTokCampaignSelectionDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() externalCampaignId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: "TikTok's raw campaign status string" }) status!: string;
  @ApiPropertyOptional({ nullable: true }) objective!: string | null;
  @ApiPropertyOptional({ nullable: true }) budget!: string | null;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) startDate!: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) endDate!: string | null;
  @ApiProperty({ description: 'Selected on the "Select Campaigns" screen — only tracked campaigns get synced.' })
  tracked!: boolean;
}

export class TikTokCampaignListResponseDto {
  @ApiProperty({ type: [TikTokCampaignSelectionDto] })
  data!: TikTokCampaignSelectionDto[];
}

export class SaveTikTokCampaignSelectionDto {
  @ApiProperty({
    type: [String],
    description: 'externalCampaignId values to mark tracked. Every other campaign on this connection is un-tracked.',
    example: ['1234567890123456'],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  externalCampaignIds!: string[];
}
