import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import { ActivityEntity, ActivityLogService } from './activity-log.service';

export class ListActivityQueryDto {
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page.' })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Only entries about this entity (e.g. a merchant user id).',
  })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ enum: Object.values(ActivityEntity) })
  @IsOptional()
  @IsIn(Object.values(ActivityEntity))
  entityType?: string;
}

@ApiTags('Admin Activity Log')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin/activity')
export class ActivityLogController {
  constructor(private readonly activity: ActivityLogService) {}

  @Get()
  @ApiOperation({
    summary: 'Audit trail of every super admin write, newest first',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        nextCursor: { type: 'string', nullable: true },
      },
    },
  })
  list(@Query() query: ListActivityQueryDto) {
    return this.activity.list({
      limit: query.limit ?? 50,
      cursor: query.cursor,
      entityType: query.entityType,
      entityId: query.entityId,
    });
  }
}
