import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // Moved off bare '/' so the Zomaal Shop admin panel's static index.html
  // (served by ServeStaticModule) can own the root path instead of this
  // scaffold placeholder shadowing it.
  @Get('health')
  @ApiExcludeEndpoint()
  getHello(): string {
    return this.appService.getHello();
  }
}
