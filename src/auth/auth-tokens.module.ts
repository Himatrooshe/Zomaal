import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthTokensService } from './auth-tokens.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthTokensService],
  exports: [AuthTokensService],
})
export class AuthTokensModule {}
