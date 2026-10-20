import { Transform } from 'class-transformer';
import { trimExpenseText } from '../expense-date.util';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ExpenseGroup } from '@prisma/client';
import {
  IsIn,
  ValidateIf,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'Packaging Supplies', maxLength: 80 })
  @Transform(trimExpenseText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    enum: ExpenseGroup,
    default: ExpenseGroup.OTHER,
    description: 'Which of the 5 summary buckets this category rolls into.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsIn(Object.values(ExpenseGroup))
  group?: ExpenseGroup;

  @ApiPropertyOptional({ description: 'Icon identifier for the mobile app.' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional({ example: '#FF6B00' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}

export class UpdateExpenseCategoryDto extends PartialType(
  CreateExpenseCategoryDto,
  { skipNullProperties: false },
) {}

export class ExpenseCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ExpenseGroup }) group!: ExpenseGroup;
  @ApiPropertyOptional({ nullable: true, type: String }) icon!: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) color!: string | null;
  @ApiProperty() isSystem!: boolean;
}

export class ExpenseCategoryListResponseDto {
  @ApiProperty({ type: [ExpenseCategoryResponseDto] })
  categories!: ExpenseCategoryResponseDto[];
}
