import { Module } from '@nestjs/common';
import { WhatsAppTriggerService } from './whatsapp-trigger.service';

// Leaf module: imported by EcommerceFinancialModule, which ShippingModule
// already depends on — so it must never import ecommerce or shipping.
@Module({
  providers: [WhatsAppTriggerService],
  exports: [WhatsAppTriggerService],
})
export class WhatsAppTriggerModule {}
