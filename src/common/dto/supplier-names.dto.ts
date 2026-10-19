import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SupplierNamesDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: 50,
    description:
      'Supplier names available when recording purchases of this item. Empty array clears the list; existing purchases retain their snapshot.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((name: unknown) =>
          typeof name === 'string' ? name.trim() : name,
        )
      : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique((name: unknown) =>
    typeof name === 'string' ? name.toLowerCase() : name,
  )
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(120, { each: true })
  supplierNames?: string[];
}
