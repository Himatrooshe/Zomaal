import { ApiProperty } from '@nestjs/swagger';
import { StoreResponseDto } from '../../stores/dto/store-response.dto';

export class UserProfileDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  id: string;

  @ApiProperty({ example: '+212612345678' })
  phone: string;

  @ApiProperty({ example: true })
  isPhoneVerified: boolean;

  @ApiProperty({ example: false })
  onboardingComplete: boolean;

  @ApiProperty({ example: '2026-07-16T10:30:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-07-16T10:30:00.000Z', format: 'date-time' })
  updatedAt: string;

  @ApiProperty({ type: () => StoreResponseDto, nullable: true })
  store: StoreResponseDto | null;
}
