import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ExpenseGroup } from '@prisma/client';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExpenseCategoryDto {
  @ApiProperty({ example: 'Packaging Supplies', maxLength: 80 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({
    enum: ExpenseGroup,
    default: ExpenseGroup.OTHER,
    description: 'Which of the 5 summary buckets this category rolls into.',
  })
  @IsOptional()
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

export class UpdateExpenseCategoryDto extends PartialType(CreateExpenseCategoryDto) {}

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
