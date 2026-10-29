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

describe('Returns HTTP validation', () => {
  let app: INestApplication;
  const detect = jest.fn().mockResolvedValue({ returnRequestId: 'rr-1' });
  const access = { userId: 'user-1', storeId: 'store-1', baseCurrency: 'MAD' };
  const search = jest.fn().mockResolvedValue({ data: [] });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReturnRequestController],
      providers: [
        { provide: ReturnRequestService, useValue: { search, detect } },
      ],
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
      .useValue({
        canActivate(context: ExecutionContext) {
          context
            .switchToHttp()
            .getRequest<{ storeAccess: unknown }>().storeAccess = access;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
  });

  beforeEach(() => {
    search.mockClear();
    detect.mockClear();
  });
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
    expect(search).toHaveBeenCalledWith('user-1', 'ORD-1001', access);
  });
  it.each([
    {},
    { value: '' },
    { value: '   ' },
    { value: '\t\n' },
    { value: 123 },
    { value: [] },
    { value: 'ORD-1', orderId: '' },
    { value: 'ORD-1', orderId: '   ' },
    { value: 'ORD-1', orderId: 'not-a-uuid' },
  ])('rejects invalid scan input %j before detection', async (body) => {
    await request(app.getHttpServer<Server>())
      .post('/ecommerce/returns/detect')
      .send(body)
      .expect(400);
    expect(detect).not.toHaveBeenCalled();
  });

  it('trims scan values and forwards request access', async () => {
    await request(app.getHttpServer<Server>())
      .post('/ecommerce/returns/detect')
      .send({ value: '  ORD-1001  ' })
      .expect(200);
    expect(detect).toHaveBeenCalledWith(
      'user-1',
      { value: 'ORD-1001' },
      access,
    );
  });

  it('accepts a valid internal order UUID', async () => {
    const body = {
      value: 'ORD-1001',
      orderId: 'ac02e08d-8f54-44e8-971f-d3cb3e827028',
    };
    await request(app.getHttpServer<Server>())
      .post('/ecommerce/returns/detect')
      .send(body)
      .expect(200);
    expect(detect).toHaveBeenCalledWith('user-1', body, access);
  });
});
