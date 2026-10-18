import { Module } from '@nestjs/common';
import { WhatsAppTriggerModule } from '../whatsapp/whatsapp-trigger.module';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import { OrderStockService } from './order-stock.service';

// Standalone leaf module (depends only on PrismaService) so that both
// EcommerceModule (controller endpoints) and ShippingModule (courier
// sync/webhook triggers) can import it without creating a circular
// module dependency — EcommerceModule already imports ShippingModule.
@Module({
  imports: [WhatsAppTriggerModule],
  providers: [EcommerceOrderFinancialService, OrderStockService],
  exports: [EcommerceOrderFinancialService, OrderStockService],
})
export class EcommerceFinancialModule {}
