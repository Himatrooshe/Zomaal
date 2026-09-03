import { Module } from '@nestjs/common';
import { CurrencyModule } from '../currency/currency.module';
import { ExpenseController } from './expense.controller';
import { ExpenseService } from './expense.service';
import { AdSpendController } from './ad-spend.controller';
import { AdSpendService } from './ad-spend.service';

@Module({
  imports: [CurrencyModule],
  controllers: [ExpenseController, AdSpendController],
  providers: [ExpenseService, AdSpendService],
  exports: [ExpenseService, AdSpendService],
})
export class FinanceModule {}
