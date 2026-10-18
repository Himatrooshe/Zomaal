import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerRiskService } from './customer-risk.service';
import { DuplicateOrdersController } from './duplicate-orders.controller';
import { DuplicateOrdersService } from './duplicate-orders.service';

@Module({
  imports: [NotificationsModule],
  // DuplicateOrdersController first: its static `customers/duplicate-orders`
  // path must register before CustomersController's `customers/:customerId`.
  controllers: [DuplicateOrdersController, CustomersController],
  providers: [CustomersService, CustomerRiskService, DuplicateOrdersService],
  // Exported so EcommerceModule/ShippingModule can feed risk signals
  // (returns, cancellations, courier refusals/no-answer) without this
  // module depending back on either of them.
  exports: [CustomerRiskService],
})
export class CustomersModule {}
