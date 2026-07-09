import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class SenditLabelsDto {
  @ApiProperty({ example: 'DH1,DH2,DH3' })
  @IsString()
  codesToPrint: string;

  @ApiProperty({ description: '1 = thermal 10x10cm, 0 = A4' })
  @IsIn([0, 1])
  printFormat: number;
}
