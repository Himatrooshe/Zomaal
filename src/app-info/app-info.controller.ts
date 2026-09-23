import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { AppInfoService } from './app-info.service';
import { AppInfoResponseDto } from './dto/app-info-response.dto';

@ApiTags('App')
@ApiProduces('application/json')
@Controller('app')
export class AppInfoController {
  constructor(private readonly appInfoService: AppInfoService) {}

  @Get('info')
  @ApiOperation({
    summary: 'About this App + Privacy Policy links',
    description:
      'Public endpoint for the Settings → About section. Returns configured URLs and app version. Missing URLs are null — the client should hide those rows rather than invent content.',
  })
  @ApiOkResponse({
    description: 'App metadata and legal links.',
    type: AppInfoResponseDto,
  })
  getInfo() {
    return this.appInfoService.getInfo();
  }
}
