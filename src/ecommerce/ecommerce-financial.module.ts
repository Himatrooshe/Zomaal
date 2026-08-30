import { Module } from '@nestjs/common';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';

// Standalone leaf module (depends only on PrismaService) so that both
// EcommerceModule (controller endpoints) and ShippingModule (courier
// sync/webhook triggers) can import it without creating a circular
// module dependency — EcommerceModule already imports ShippingModule.
@Module({
  providers: [EcommerceOrderFinancialService],
  exports: [EcommerceOrderFinancialService],
})
export class EcommerceFinancialModule {}
