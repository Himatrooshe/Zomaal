import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { CourierCostsService } from './courier-costs.service';

@Module({
  imports: [CurrencyModule],
  providers: [CourierCostsService],
  exports: [CourierCostsService],
})
export class CourierCostsModule {}
