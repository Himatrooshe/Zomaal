import { ApiProperty } from '@nestjs/swagger';

export class AccountDeletionResponseDto {
  @ApiProperty({
    example:
      'Your account will be permanently deleted in 30 days. Log in and cancel before then to keep it.',
  })
  message: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  deletionScheduledFor: string | null;
}
