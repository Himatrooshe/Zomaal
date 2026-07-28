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

@ApiExcludeController()
@UseGuards(EcommerceSchedulerGuard)
@Controller('internal/ecommerce')
export class EcommerceSchedulerController {
  constructor(private readonly syncService: EcommerceSyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronize(): Promise<ScheduledEcommerceSyncResponse> {
    return this.syncService.syncAllActiveConnections();
  }
}
