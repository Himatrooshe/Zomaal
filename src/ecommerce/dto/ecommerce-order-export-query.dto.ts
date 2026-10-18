import { OmitType } from '@nestjs/swagger';
import { EcommerceOrderQueryDto } from './ecommerce-order-query.dto';

/** Export uses the list filters but always includes every matching row. */
export class EcommerceOrderExportQueryDto extends OmitType(
  EcommerceOrderQueryDto,
  ['page', 'limit'] as const,
) {}
