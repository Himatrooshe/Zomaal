import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AccountsSchedulerController } from './accounts-scheduler.controller';
import { AccountsSchedulerGuard } from './accounts-scheduler.guard';
import { ProfileMediaModule } from '../profile-media/profile-media.module';
import { AuthTokensModule } from '../auth/auth-tokens.module';

@Module({
  imports: [ProfileMediaModule, AuthTokensModule],
  controllers: [UsersController, AccountsSchedulerController],
  providers: [UsersService, AccountsSchedulerGuard],
  exports: [UsersService],
})
export class UsersModule {}
