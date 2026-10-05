import {
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AccountsSchedulerGuard } from './accounts-scheduler.guard';
import { UsersService } from './users.service';

@ApiExcludeController()
@UseGuards(AccountsSchedulerGuard)
@Controller('internal/accounts')
export class AccountsSchedulerController {
  constructor(private readonly usersService: UsersService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  run() {
    return this.usersService.purgeDueAccounts();
  }
}
