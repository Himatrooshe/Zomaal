import { ApiProperty } from '@nestjs/swagger';

export class AppInfoResponseDto {
  @ApiProperty({ example: 'Zomaal' })
  appName: string;

  @ApiProperty({
    description: 'App build / marketing version shown on About this App.',
    example: '1.0.0',
  })
  version: string;

  @ApiProperty({
    description: 'Public Privacy Policy URL. Null until configured.',
    example: 'https://zomaal.com/privacy',
    nullable: true,
    type: String,
  })
  privacyPolicyUrl: string | null;

  @ApiProperty({
    description: 'Public About this App URL. Null until configured.',
    example: 'https://zomaal.com/about',
    nullable: true,
    type: String,
  })
  aboutUrl: string | null;

  @ApiProperty({
    description: 'Public Terms of Service URL. Null until configured.',
    example: 'https://zomaal.com/terms',
    nullable: true,
    type: String,
  })
  termsOfServiceUrl: string | null;

  @ApiProperty({
    description: 'Support contact email. Null until configured.',
    example: 'support@example.com',
    nullable: true,
    type: String,
  })
  supportEmail: string | null;
}
