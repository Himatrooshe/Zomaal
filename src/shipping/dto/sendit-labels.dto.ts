import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class SenditLabelsDto {
  @ApiProperty({
    description:
      'Comma-separated Sendit delivery codes. Do not include spaces or an array wrapper.',
    example: 'DH000123456MA,DH000123457MA,DH000123458MA',
  })
  @IsString()
  codesToPrint: string;

  @ApiProperty({
    description: 'Label layout: 0 = A4 sheet, 1 = 10x10 cm thermal label.',
    enum: [0, 1],
    example: 1,
  })
  @IsIn([0, 1])
  printFormat: number;
}
