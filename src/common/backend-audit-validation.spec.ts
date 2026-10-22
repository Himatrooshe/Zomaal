import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from './validation-pipe.options';
import { CreateStoreDto } from '../stores/dto/create-store.dto';
import { UpdateStoreDto } from '../stores/dto/update-store.dto';
import { CreateRoleDto, UpdateRoleDto } from '../roles/dto/role.dto';
import {
  CreateProductCategoryDto,
  ProductCategoryQueryDto,
  UpdateProductCategoryDto,
} from '../warehouse/dto/category.dto';
import {
  CompareCatalogQueryDto,
  WarehouseProductQueryDto,
} from '../warehouse/dto/product.dto';
import { ReturnListQueryDto } from '../ecommerce/dto/return-request.dto';
import { InvoiceListQueryDto } from '../billing/dto/billing.dto';
import { NotificationListQueryDto } from '../notifications/dto/notification.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const body = (metatype: Type<unknown>, value: object) =>
  pipe.transform(value, { type: 'body', metatype });
const query = (metatype: Type<unknown>, value: object) =>
  pipe.transform(value, { type: 'query', metatype });

describe('Live audit body-validation regressions', () => {
  it.each([
    'ownerName',
    'businessName',
    'address',
    'city',
    'country',
    'baseCurrency',
  ])('rejects required Store null %s', async (field) => {
    await expect(
      body(UpdateStoreDto, { [field]: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each(['name', 'permissions'])(
    'rejects required Role null %s',
    async (field) => {
      await expect(
        body(UpdateRoleDto, { [field]: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each(['name', 'position', 'isActive'])(
    'rejects required Category null %s',
    async (field) => {
      await expect(
        body(UpdateProductCategoryDto, { [field]: null }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each([2147483648, -1, 1.5])(
    'rejects invalid category position %s',
    async (position) => {
      await expect(
        body(UpdateProductCategoryDto, { position }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it.each([
    [
      CreateStoreDto,
      { ownerName: 'QA', businessName: '  ', address: 'QA', city: 'QA' },
    ],
    [UpdateStoreDto, { businessName: '\t\n' }],
    [CreateRoleDto, { name: '  ', permissions: [] }],
    [UpdateRoleDto, { name: '  ' }],
    [CreateProductCategoryDto, { name: '  ' }],
    [UpdateProductCategoryDto, { name: '  ' }],
  ] as Array<[Type<unknown>, object]>)(
    'rejects blank display names on %p',
    async (metatype, value) => {
      await expect(body(metatype, value)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
  it.each(['ZZZ', '123', 'MAD ', null])(
    'rejects invalid store currency %p',
    async (baseCurrency) => {
      await expect(
        body(UpdateStoreDto, { baseCurrency }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('normalizes valid currency and names while retaining nullable clears', async () => {
    await expect(
      body(UpdateStoreDto, {
        baseCurrency: 'mad',
        businessName: ' QA ',
        logoUrl: null,
      }),
    ).resolves.toMatchObject({
      baseCurrency: 'MAD',
      businessName: 'QA',
      logoUrl: null,
    });
    await expect(
      body(UpdateRoleDto, { permissions: [], description: null }),
    ).resolves.toMatchObject({ permissions: [], description: null });
    await expect(
      body(UpdateProductCategoryDto, {
        parentId: null,
        description: null,
        position: 2147483647,
        isActive: false,
      }),
    ).resolves.toMatchObject({
      parentId: null,
      description: null,
      position: 2147483647,
      isActive: false,
    });
  });
});

describe.each([
  WarehouseProductQueryDto,
  CompareCatalogQueryDto,
  ReturnListQueryDto,
  InvoiceListQueryDto,
  NotificationListQueryDto,
])('%p pagination regression', (metatype) => {
  const input = (extra: object) => ({
    ...(metatype === CompareCatalogQueryDto ? { platform: 'WAREHOUSE' } : {}),
    ...extra,
  });
  it.each(['1e100', '1e3', '0x10', '1.5', '1junk', '1000001', ['1', '2']])(
    'rejects unsafe/malformed page %p',
    async (page) => {
      await expect(query(metatype, input({ page }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
  it.each(['1.5', '1junk', '1e2', ['1', '2']])(
    'rejects malformed limit %p',
    async (limit) => {
      await expect(query(metatype, input({ limit }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
  it('preserves bounded integer query semantics', async () => {
    await expect(
      query(metatype, input({ page: '1000000', limit: '100' })),
    ).resolves.toMatchObject({ page: 1000000, limit: 100 });
    await expect(query(metatype, input({ page: '0' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe.each([
  [NotificationListQueryDto, 'unreadOnly'],
  [ProductCategoryQueryDto, 'includeInactive'],
] as Array<[Type<unknown>, string]>)(
  '%p strict boolean queries',
  (metatype, field) => {
    it.each(['invalid', 'TRUE', '1', '', ['false', 'true']])(
      'rejects %p',
      async (value) => {
        await expect(
          query(metatype, { [field]: value }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );
    it.each([
      ['true', true],
      ['false', false],
    ])('converts %s exactly', async (value, expected) => {
      await expect(query(metatype, { [field]: value })).resolves.toMatchObject({
        [field]: expected,
      });
    });
  },
);
