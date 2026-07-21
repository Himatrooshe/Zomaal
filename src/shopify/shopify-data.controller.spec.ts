import {
  type ExecutionContext,
  type INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShopifyDataPageQueryDto } from './dto/shopify-data-query.dto';
import { ShopifyDataController } from './shopify-data.controller';
import { ShopifyDataService } from './shopify-data.service';

describe('ShopifyDataController OpenAPI contract', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ShopifyDataController],
      providers: [
        {
          provide: ShopifyDataService,
          useValue: {
            getOverview: jest.fn(),
            listProducts: jest.fn().mockResolvedValue({
              data: [],
              pageInfo: {
                hasNextPage: false,
                hasPreviousPage: false,
                startCursor: null,
                endCursor: null,
              },
            }),
            listOrders: jest.fn(),
            listCustomers: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const incomingRequest = context
            .switchToHttp()
            .getRequest<{ user?: { userId: string; phone: string } }>();
          incomingRequest.user = {
            userId: 'user-1',
            phone: '+212600000001',
          };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    '/shopify/store',
    '/shopify/products',
    '/shopify/orders',
    '/shopify/customers',
  ])(
    'documents bearer security and complete upstream failures for %s',
    (path) => {
      const document = createDocument(app);
      const operation = document.paths[path]?.get;

      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
      for (const status of ['200', '401', '403', '404', '409', '502', '503']) {
        expect(operation?.responses).toHaveProperty(status);
      }
      expect(operation?.responses['200']).toMatchObject({
        headers: {
          'Cache-Control': {
            schema: {
              example: 'private, no-store',
            },
          },
        },
      });
    },
  );

  it.each(['/shopify/products', '/shopify/orders', '/shopify/customers'])(
    'documents validated cursor pagination for %s',
    (path) => {
      const operation = createDocument(app).paths[path]?.get;

      expect(operation?.responses).toHaveProperty('400');
      const first = operation?.parameters?.find(
        (parameter) => 'name' in parameter && parameter.name === 'first',
      );
      const after = operation?.parameters?.find(
        (parameter) => 'name' in parameter && parameter.name === 'after',
      );
      const query = operation?.parameters?.find(
        (parameter) => 'name' in parameter && parameter.name === 'query',
      );

      expect(first).toMatchObject({
        name: 'first',
        required: false,
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      });
      expect(after).toMatchObject({
        name: 'after',
        required: false,
        schema: {
          maxLength: 2048,
        },
      });
      expect(query).toMatchObject({
        name: 'query',
        required: false,
        schema: {
          maxLength: 500,
        },
      });
    },
  );

  it('accepts empty optional cursor and search parameters as omitted', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });

    const result = (await pipe.transform(
      { after: '', query: '' },
      { type: 'query', metatype: ShopifyDataPageQueryDto },
    )) as ShopifyDataPageQueryDto;

    expect(result).toMatchObject({ first: 20 });
    expect(result.after).toBeUndefined();
    expect(result.query).toBeUndefined();
  });
});

function createDocument(app: INestApplication) {
  const config = new DocumentBuilder().setTitle('Test').addBearerAuth().build();
  return SwaggerModule.createDocument(app, config);
}
