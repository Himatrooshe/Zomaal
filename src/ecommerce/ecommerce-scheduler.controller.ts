import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { EcommerceSchedulerGuard } from './ecommerce-scheduler.guard';
import {
  EcommerceSyncService,
  type ScheduledEcommerceSyncResponse,
} from './ecommerce-sync.service';
import {
  EcommerceMetricsService,
  type ScheduledEcommerceMetricsResponse,
} from './ecommerce-metrics.service';

interface ScheduledEcommerceReconciliationResponse {
  orders: ScheduledEcommerceSyncResponse;
  metrics: ScheduledEcommerceMetricsResponse;
}

@ApiExcludeController()
@UseGuards(EcommerceSchedulerGuard)
@Controller('internal/ecommerce')
export class EcommerceSchedulerController {
  constructor(
    private readonly syncService: EcommerceSyncService,
    private readonly metricsService: EcommerceMetricsService,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async synchronize(): Promise<ScheduledEcommerceReconciliationResponse> {
    const orders = await this.syncService.syncAllActiveConnections();
    const metrics = await this.metricsService.refreshAllActiveConnections();
    return { orders, metrics };
  }
}
