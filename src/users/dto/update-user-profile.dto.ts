import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    description:
      'Display name. Stored on the store (owner) or staff record backing this user — whichever applies.',
    example: 'Ahmed Alaoui',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Public HTTPS URL of the personal profile photo.',
    example: 'https://example.com/avatar.png',
    format: 'uri',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  photoUrl?: string;
}
