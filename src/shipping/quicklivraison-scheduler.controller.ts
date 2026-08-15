import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { QuickLivraisonSchedulerGuard } from './quicklivraison-scheduler.guard';
import { QuickLivraisonSyncService } from './quicklivraison-sync.service';

@ApiExcludeController()
@UseGuards(QuickLivraisonSchedulerGuard)
@Controller('internal/shipping/quicklivraison')
export class QuickLivraisonSchedulerController {
  constructor(private readonly sync: QuickLivraisonSyncService) {}

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  synchronize() {
    return this.sync.syncAllActiveConnections();
  }
}
