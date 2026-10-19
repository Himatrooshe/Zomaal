import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { PermissionGuard } from '../access/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../common/validation-pipe.options';
import { ReturnRequestController } from './return-request.controller';
import { ReturnRequestService } from './return-request.service';

describe('Returns search HTTP validation', () => {
  let app: INestApplication;
  const search = jest.fn().mockResolvedValue({ data: [] });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReturnRequestController],
      providers: [{ provide: ReturnRequestService, useValue: { search } }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context
            .switchToHttp()
            .getRequest<{ user: { userId: string } }>().user = {
            userId: 'user-1',
          };
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
  });

  beforeEach(() => search.mockClear());
  afterAll(async () => app.close());

  it.each(['', '?q=', '?q=%20%09', '?q=a&q=b', '?q[]=a'])(
    'rejects invalid query %s before searching',
    async (query) => {
      await request(app.getHttpServer<Server>())
        .get(`/ecommerce/returns/search${query}`)
        .expect(400);
      expect(search).not.toHaveBeenCalled();
    },
  );

  it('accepts a trimmed reference', async () => {
    await request(app.getHttpServer<Server>())
      .get('/ecommerce/returns/search?q=%20ORD-1001%20')
      .expect(200, { data: [] });
    expect(search).toHaveBeenCalledWith('user-1', 'ORD-1001');
  });
});
