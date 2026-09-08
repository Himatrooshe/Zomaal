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

  @ApiPropertyOptional({
    description:
      'Personal address. For a store owner this is the store’s pickup address (same field PUT /stores/me edits); for a staff member it is personal to them.',
    example: '123 Rue Hassan II',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  address?: string;

  @ApiPropertyOptional({
    description: 'Personal city, same mapping as `address`.',
    example: 'Casablanca',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  city?: string;
}
