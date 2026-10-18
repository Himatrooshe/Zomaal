import { Module } from '@nestjs/common';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { AdsModule } from '../ads/ads.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [WarehouseModule, AdsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
