import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Health check for Cloud Run / CI. Bare `/` returns 404 so the admin
  // portal is not advertised; open `/login` deliberately for the panel.
  @Get('health')
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }
}
