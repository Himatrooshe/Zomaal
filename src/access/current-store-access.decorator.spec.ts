import 'reflect-metadata';
import { CurrentStoreAccess } from './current-store-access.decorator';
import type { StoreAccess } from './store-access.service';

// createParamDecorator wraps the factory in Nest's param-metadata machinery,
// so it can't be called directly in a unit test. This is the standard
// NestJS-docs pattern for extracting the underlying factory to test it in
// isolation, without spinning up a full request pipeline.
function getParamDecoratorFactory(decorator: () => ParameterDecorator) {
  class TestHost {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public method(@decorator() _value: unknown) {}
  }
  const args = Reflect.getMetadata(
    '__routeArguments__',
    TestHost,
    'method',
  ) as Record<string, { factory: (data: unknown, ctx: unknown) => unknown }>;
  return args[Object.keys(args)[0]].factory;
}

describe('CurrentStoreAccess', () => {
  const factory = getParamDecoratorFactory(CurrentStoreAccess);

  it('reads storeAccess off the request that PermissionGuard attached', () => {
    const access: StoreAccess = {
      storeId: 'store-1',
      baseCurrency: 'MAD',
      userId: 'staff-user',
      isOwner: false,
      staffMemberId: 'staff-1',
      permissions: [],
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ storeAccess: access }) }),
    };

    expect(factory(undefined, ctx)).toBe(access);
  });

  it('is undefined on a route PermissionGuard never ran on', () => {
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    };

    expect(factory(undefined, ctx)).toBeUndefined();
  });
});
