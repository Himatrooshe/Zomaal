import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerRiskService } from './customer-risk.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerRiskService],
  // Exported so EcommerceModule/ShippingModule can feed risk signals
  // (returns, cancellations, courier refusals/no-answer) without this
  // module depending back on either of them.
  exports: [CustomerRiskService],
})
export class CustomersModule {}
