import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  WhatsAppDispatchService,
  type DispatchSummary,
} from './whatsapp-dispatch.service';
import { WhatsAppSchedulerGuard } from './whatsapp-scheduler.guard';

@ApiExcludeController()
@UseGuards(WhatsAppSchedulerGuard)
@Controller('internal/whatsapp')
export class WhatsAppSchedulerController {
  constructor(private readonly dispatch: WhatsAppDispatchService) {}

  @Post('dispatch')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  run(): Promise<DispatchSummary> {
    return this.dispatch.runDue();
  }
}
