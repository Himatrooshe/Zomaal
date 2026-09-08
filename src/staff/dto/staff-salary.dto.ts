import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class SetSalaryProfileDto {
  @ApiProperty({ example: '3500.00', description: 'Base salary amount in the store currency.' })
  @IsNumberString()
  baseSalary!: string;

  @ApiProperty({ enum: SalaryFrequency })
  @IsIn(Object.values(SalaryFrequency))
  frequency!: SalaryFrequency;

  @ApiProperty({ enum: SalaryPaymentMethod })
  @IsIn(Object.values(SalaryPaymentMethod))
  paymentMethod!: SalaryPaymentMethod;

  @ApiPropertyOptional({
    enum: SalaryExpenseHandling,
    default: SalaryExpenseHandling.AUTOMATIC,
    description:
      'AUTOMATIC: the system generates the salary expense on schedule and manual entries are blocked. MANUAL: the owner records each payment by hand.',
  })
  @IsOptional()
  @IsIn(Object.values(SalaryExpenseHandling))
  expenseHandling?: SalaryExpenseHandling;

  @ApiProperty({ description: 'ISO date the salary schedule starts from.' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class SalaryProfileResponseDto {
  @ApiProperty() baseSalary!: string;
  @ApiProperty({ enum: SalaryFrequency }) frequency!: SalaryFrequency;
  @ApiProperty({ enum: SalaryPaymentMethod }) paymentMethod!: SalaryPaymentMethod;
  @ApiProperty({ enum: SalaryExpenseHandling }) expenseHandling!: SalaryExpenseHandling;
  @ApiProperty() startDate!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) nextPaymentDate!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
}

export class SalaryProfileWrapperDto {
  @ApiPropertyOptional({
    nullable: true,
    type: SalaryProfileResponseDto,
    description: 'null when no salary profile has been set yet.',
  })
  profile!: SalaryProfileResponseDto | null;
}

export class CreateSalaryPaymentDto {
  @ApiProperty({
    type: [String],
    description:
      'Staff members to pay in this batch (Select Staff Member screen — usually one, but supports multi-select).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  staffMemberIds!: string[];

  @ApiPropertyOptional({
    description:
      'Amount per staff member. Defaults to each staff member\'s configured base salary when omitted.',
  })
  @IsOptional()
  @IsNumberString()
  amount?: string;

  @ApiProperty({ description: 'ISO date this payment is for.' })
  @IsDateString()
  paymentDate!: string;

  @ApiProperty({ enum: SalaryPaymentMethod })
  @IsIn(Object.values(SalaryPaymentMethod))
  paymentMethod!: SalaryPaymentMethod;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  receiptUrl?: string;
}

export class SalaryPaymentResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() staffMemberId!: string;
  @ApiProperty() staffName!: string;
  @ApiProperty() amount!: string;
  @ApiProperty() paymentDate!: string;
  @ApiPropertyOptional({ nullable: true, type: String }) paidAt!: string | null;
  @ApiProperty({ enum: SalaryPaymentMethod }) paymentMethod!: SalaryPaymentMethod;
  @ApiProperty({ enum: SalaryPaymentStatus }) status!: SalaryPaymentStatus;
  @ApiPropertyOptional({ nullable: true, type: String }) notes!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) receiptUrl!: string | null;
}

export class SalaryPaymentBatchResponseDto {
  @ApiProperty({ type: [SalaryPaymentResponseDto] })
  payments!: SalaryPaymentResponseDto[];
}

export class SalaryPaymentListResponseDto {
  @ApiProperty({ type: [SalaryPaymentResponseDto] })
  payments!: SalaryPaymentResponseDto[];

  @ApiProperty() total!: number;
}

export class SalaryPaymentListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
