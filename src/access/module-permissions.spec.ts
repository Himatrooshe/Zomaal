import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AdsController } from '../ads/ads.controller';
import { TikTokAdsController } from '../ads/tiktok/tiktok-ads.controller';
import { EcommerceController } from '../ecommerce/ecommerce.controller';
import { ReturnRequestController } from '../ecommerce/return-request.controller';
import { ShippingDashboardController } from '../shipping/shipping-dashboard.controller';
import { BarcodeController } from '../warehouse/barcode.controller';
import { CategoryController } from '../warehouse/category.controller';
import { InventoryController } from '../warehouse/inventory.controller';
import { MediaController } from '../warehouse/media.controller';
import { PackagingController } from '../warehouse/packaging.controller';
import { ProductController } from '../warehouse/product.controller';
import { PermissionGuard } from './permission.guard';
import { PERMISSIONS, type Permission } from './permissions';
import { REQUIRED_PERMISSIONS } from './require-permission.decorator';

type ControllerClass = { prototype: Record<string, unknown>; name: string };

const reflector = new Reflector();

function handlerNames(controller: ControllerClass): string[] {
  return Object.getOwnPropertyNames(controller.prototype).filter(
    (name) =>
      name !== 'constructor' &&
      typeof controller.prototype[name] === 'function' &&
      Reflect.getMetadata('path', controller.prototype[name]) !== undefined,
  );
}

function required(controller: ControllerClass, handler: string): Permission[] | undefined {
  const method = controller.prototype[handler];
  if (typeof method !== 'function') {
    throw new Error(`${controller.name}.${handler} is not a route handler`);
  }
  return reflector.get<Permission[]>(REQUIRED_PERMISSIONS, method as () => unknown);
}

const GATED: [ControllerClass, string][] = [
  [EcommerceController, 'orders/analytics/returns'],
  [ReturnRequestController, 'returns'],
  [ShippingDashboardController, 'orders'],
  [ProductController, 'products'],
  [CategoryController, 'products'],
  [InventoryController, 'products'],
  [BarcodeController, 'products'],
  [PackagingController, 'products'],
  [MediaController, 'products'],
  [AdsController, 'ads'],
  [TikTokAdsController, 'ads'],
];

// Owner-only store connection admin: connecting/syncing a platform is not a
// staff permission, so these stay JWT + store-scoped only.
const UNGATED_BY_DESIGN: Record<string, string[]> = {
  EcommerceController: ['listConnections', 'syncConnection'],
};

describe('module permission gating', () => {
  it.each(GATED)('%p runs PermissionGuard', (controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];
    expect(guards).toContain(PermissionGuard);
  });

  it.each(GATED)('%p gates every route with a module permission (%s)', (controller) => {
    const exempt = UNGATED_BY_DESIGN[controller.name] ?? [];
    const ungated = handlerNames(controller).filter(
      (h) => !exempt.includes(h) && !(required(controller, h)?.length),
    );
    expect(ungated).toEqual([]);
  });

  it('maps representative routes to the expected permission keys', () => {
    expect(required(EcommerceController, 'listOrders')).toEqual([PERMISSIONS.ORDERS_VIEW]);
    expect(required(EcommerceController, 'dispatchOrder')).toEqual([PERMISSIONS.ORDERS_EDIT]);
    expect(required(EcommerceController, 'getHome')).toEqual([PERMISSIONS.ANALYTICS_VIEW]);
    expect(required(ReturnRequestController, 'detect')).toEqual([PERMISSIONS.RETURNS_SCAN]);
    expect(required(ReturnRequestController, 'verify')).toEqual([PERMISSIONS.RETURNS_PROCESS]);
    expect(required(ProductController, 'create')).toEqual([PERMISSIONS.PRODUCTS_ADD]);
    expect(required(CategoryController, 'archive')).toEqual([PERMISSIONS.PRODUCTS_DELETE]);
    expect(required(AdsController, 'getCampaigns')).toEqual([PERMISSIONS.ADS_VIEW]);
    expect(required(ShippingDashboardController, 'getHome')).toEqual([PERMISSIONS.ORDERS_VIEW]);
  });
});
