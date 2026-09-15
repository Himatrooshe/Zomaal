import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';

export const CurrentSuperAdmin = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: SuperAdminJwtPayload }>();
    return request.user;
  },
);
