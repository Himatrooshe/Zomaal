import { Injectable } from '@nestjs/common';
import type { ShippingShipmentStatus } from '@prisma/client';
import { AmeexConnectionService } from './ameex-connection.service';
import { AmeexOverviewService } from './ameex-overview.service';
import { AmeexShipmentService } from './ameex-shipment.service';
import type {
  SharedOverviewQueryDto,
  SharedShipmentQueryDto,
  SharedSyncQueryDto,
} from './dto/shipping-provider.dto';
import { ShippingProvider } from './dto/shipping-provider.dto';
import { ForceLogConnectionService } from './forcelog-connection.service';
import { ForceLogOverviewService } from './forcelog-overview.service';
import { ForceLogShipmentService } from './forcelog-shipment.service';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import { OzoneExpressOverviewService } from './ozoneexpress-overview.service';
import { OzoneExpressShipmentService } from './ozoneexpress-shipment.service';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { QuickLivraisonOverviewService } from './quicklivraison-overview.service';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';
import { QuickLivraisonSyncService } from './quicklivraison-sync.service';
import { SenditConnectionService } from './sendit-connection.service';
import { SenditOverviewService } from './sendit-overview.service';
import { SenditShipmentService } from './sendit-shipment.service';
import { SenditSyncService } from './sendit-sync.service';

type Value = Record<string, unknown>;

@Injectable()
export class ShippingProviderService {
  constructor(
    private readonly senditConnection: SenditConnectionService,
    private readonly senditShipments: SenditShipmentService,
    private readonly senditSync: SenditSyncService,
    private readonly senditOverview: SenditOverviewService,
    private readonly quickConnection: QuickLivraisonConnectionService,
    private readonly quickShipments: QuickLivraisonShipmentService,
    private readonly quickSync: QuickLivraisonSyncService,
    private readonly quickOverview: QuickLivraisonOverviewService,
    private readonly forceLogConnection: ForceLogConnectionService,
    private readonly forceLogShipments: ForceLogShipmentService,
    private readonly forceLogOverview: ForceLogOverviewService,
    private readonly ozoneConnection: OzoneExpressConnectionService,
    private readonly ozoneShipments: OzoneExpressShipmentService,
    private readonly ozoneOverview: OzoneExpressOverviewService,
    private readonly ameexConnection: AmeexConnectionService,
    private readonly ameexShipments: AmeexShipmentService,
    private readonly ameexOverview: AmeexOverviewService,
  ) {}

  async connection(userId: string, provider: ShippingProvider) {
    const raw = asValue(
      await this.connectionService(provider).getStatus(userId),
    );
    return {
      provider,
      connected: Boolean(raw.connected),
      connectedAt: nullableString(raw.connectedAt),
      lastSyncedAt: nullableString(raw.lastSyncedAt),
      lastSyncError: nullableString(raw.lastSyncError),
      message: nullableString(raw.message),
      providerDetails: providerDetails(raw, [
        'provider',
        'connected',
        'connectedAt',
        'lastSyncedAt',
        'lastSyncError',
        'message',
      ]),
    };
  }

  async list(
    userId: string,
    provider: ShippingProvider,
    query: SharedShipmentQueryDto,
  ) {
    const raw = asValue(
      await this.shipmentService(provider).list(userId, query),
    );
    const rows = Array.isArray(raw.data) ? raw.data : [];
    return {
      data: rows.map((row) => normalizeShipment(provider, asValue(row))),
      pagination: normalizePagination(raw.pagination, query),
    };
  }

  async detail(userId: string, provider: ShippingProvider, code: string) {
    const service = this.shipmentService(provider);
    const raw = asValue(
      provider === ShippingProvider.AMEEX
        ? await (service as AmeexShipmentService).get(userId, code)
        : await (
            service as
              | SenditShipmentService
              | QuickLivraisonShipmentService
              | ForceLogShipmentService
              | OzoneExpressShipmentService
          ).getByProviderCode(userId, code),
    );
    return normalizeShipment(provider, raw, true);
  }

  async timeline(userId: string, provider: ShippingProvider, code: string) {
    const service = this.shipmentService(provider);
    const raw = asValue(
      provider === ShippingProvider.AMEEX
        ? await (service as AmeexShipmentService).timeline(userId, code)
        : await (
            service as
              | SenditShipmentService
              | QuickLivraisonShipmentService
              | ForceLogShipmentService
              | OzoneExpressShipmentService
          ).getTimeline(userId, code),
    );
    return normalizeTimeline(provider, raw);
  }

  async sync(
    userId: string,
    provider: ShippingProvider,
    query: SharedSyncQueryDto,
  ) {
    let result: unknown;
    switch (provider) {
      case ShippingProvider.SENDIT:
        result = await this.senditSync.sync(userId, {
          startPage: query.startPage,
          maxPages: query.maxPages,
        });
        break;
      case ShippingProvider.QUICKLIVRAISON:
        result = await this.quickSync.sync(userId);
        break;
      case ShippingProvider.FORCELOG:
        result = await this.forceLogShipments.sync(userId, {
          limit: query.limit,
        });
        break;
      case ShippingProvider.OZONEEXPRESS:
        result = await this.ozoneShipments.sync(userId, {
          limit: query.limit,
        });
        break;
      case ShippingProvider.AMEEX:
        result = await this.ameexShipments.sync(userId, {
          limit: query.limit,
          importPageSize: query.importPageSize,
          maxImportPages: query.maxImportPages,
        });
        break;
    }
    return normalizeSync(provider, asValue(result));
  }

  async overview(
    userId: string,
    provider: ShippingProvider,
    query: SharedOverviewQueryDto,
  ) {
    const raw = asValue(
      await this.overviewService(provider).getOverview(userId, query),
    );
    return { provider, ...raw };
  }

  private connectionService(provider: ShippingProvider) {
    switch (provider) {
      case ShippingProvider.SENDIT:
        return this.senditConnection;
      case ShippingProvider.QUICKLIVRAISON:
        return this.quickConnection;
      case ShippingProvider.FORCELOG:
        return this.forceLogConnection;
      case ShippingProvider.OZONEEXPRESS:
        return this.ozoneConnection;
      case ShippingProvider.AMEEX:
        return this.ameexConnection;
    }
  }

  private shipmentService(provider: ShippingProvider) {
    switch (provider) {
      case ShippingProvider.SENDIT:
        return this.senditShipments;
      case ShippingProvider.QUICKLIVRAISON:
        return this.quickShipments;
      case ShippingProvider.FORCELOG:
        return this.forceLogShipments;
      case ShippingProvider.OZONEEXPRESS:
        return this.ozoneShipments;
      case ShippingProvider.AMEEX:
        return this.ameexShipments;
    }
  }

  private overviewService(provider: ShippingProvider) {
    switch (provider) {
      case ShippingProvider.SENDIT:
        return this.senditOverview;
      case ShippingProvider.QUICKLIVRAISON:
        return this.quickOverview;
      case ShippingProvider.FORCELOG:
        return this.forceLogOverview;
      case ShippingProvider.OZONEEXPRESS:
        return this.ozoneOverview;
      case ShippingProvider.AMEEX:
        return this.ameexOverview;
    }
  }
}

function normalizeShipment(
  provider: ShippingProvider,
  raw: Value,
  includeEvents = false,
) {
  const common = {
    id: string(raw.id),
    provider,
    providerCode: string(raw.providerCode),
    providerStatus: string(raw.providerStatus, 'UNKNOWN'),
    providerSubStatus: nullableString(
      raw.providerSubStatus ??
        raw.providerSecondaryStatus ??
        raw.providerReturnStatus ??
        raw.situation,
    ),
    normalizedStatus: string(raw.normalizedStatus) as ShippingShipmentStatus,
    reference: nullableString(raw.reference),
    recipientName: nullableString(raw.recipientName),
    recipientPhone: nullableString(raw.recipientPhone),
    address: nullableString(raw.address),
    city: nullableString(raw.city),
    cityId: nullableNumber(
      raw.cityId ?? raw.destinationDistrictId ?? raw.pickupDistrictId,
    ),
    codAmount: nullableString(raw.codAmount),
    fee: nullableString(raw.fee),
    currency: string(raw.currency, 'MAD'),
    productName: nullableString(raw.nature ?? raw.productNature),
    note: nullableString(raw.note ?? raw.comment),
    lastActionAt: nullableString(raw.lastActionAt),
    providerCreatedAt: nullableString(raw.providerCreatedAt),
    providerUpdatedAt: nullableString(raw.providerUpdatedAt),
    createdAt: string(raw.createdAt),
    updatedAt: string(raw.updatedAt),
    providerDetails: providerDetails(raw, SHIPMENT_COMMON_KEYS),
  };
  return includeEvents
    ? {
        ...common,
        events: normalizeEvents(provider, raw.events),
      }
    : common;
}

function normalizeTimeline(provider: ShippingProvider, raw: Value) {
  return {
    provider,
    providerCode: string(raw.providerCode),
    providerStatus: string(raw.providerStatus, 'UNKNOWN'),
    providerSubStatus: nullableString(
      raw.providerSubStatus ??
        raw.providerSecondaryStatus ??
        raw.providerReturnStatus ??
        raw.situation,
    ),
    normalizedStatus: string(raw.normalizedStatus) as ShippingShipmentStatus,
    lastActionAt: nullableString(raw.lastActionAt),
    events: normalizeEvents(provider, raw.events),
  };
}

function normalizeEvents(provider: ShippingProvider, value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((event) => {
    const raw = asValue(event);
    return {
      id: string(raw.id),
      provider,
      eventType: string(raw.eventType, 'shipment.status'),
      providerStatus: string(raw.providerStatus, 'UNKNOWN'),
      providerSubStatus: nullableString(
        raw.providerSubStatus ?? raw.providerSecondaryStatus,
      ),
      normalizedStatus: string(raw.normalizedStatus) as ShippingShipmentStatus,
      statusName: nullableString(raw.statusName),
      statusColor: nullableString(raw.statusColor),
      message: nullableString(raw.message),
      actor: nullableString(raw.actor),
      proofImageUrl: nullableString(raw.proofImageUrl),
      eventAt: string(raw.eventAt),
      providerDetails: providerDetails(raw, EVENT_COMMON_KEYS),
    };
  });
}

function normalizeSync(provider: ShippingProvider, raw: Value) {
  const failures = [
    ...(Array.isArray(raw.importFailures) ? raw.importFailures : []),
    ...(Array.isArray(raw.failures) ? raw.failures : []),
  ];
  const imported = number(raw.imported);
  const refreshed = number(raw.refreshed);
  const reconciled = number(raw.reconciled);
  const processed = number(raw.processed, imported + refreshed + reconciled);
  return {
    provider,
    success: raw.success !== false,
    message: nullableString(raw.message),
    syncedAt: nullableString(raw.syncedAt),
    selected: number(raw.selected, processed),
    processed,
    imported,
    refreshed,
    reconciled,
    failed: number(raw.failed) + number(raw.importFailed),
    failures,
    nextCursor: raw.nextPage ?? null,
    providerDetails: providerDetails(raw, SYNC_COMMON_KEYS),
  };
}

function normalizePagination(value: unknown, query: SharedShipmentQueryDto) {
  const raw = asValue(value);
  const total = number(raw.total);
  const limit = number(raw.limit, query.limit ?? 20);
  return {
    total,
    page: number(raw.page, query.page ?? 1),
    limit,
    totalPages: number(raw.totalPages, limit ? Math.ceil(total / limit) : 0),
  };
}

function providerDetails(raw: Value, excluded: readonly string[]) {
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([key, value]) => !excluded.includes(key) && value !== undefined,
    ),
  );
}

function asValue(value: unknown): Value {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Value)
    : {};
}

function string(value: unknown, fallback = '') {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function nullableString(value: unknown) {
  const parsed = string(value);
  return parsed || null;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const SHIPMENT_COMMON_KEYS = [
  'id',
  'provider',
  'providerCode',
  'providerStatus',
  'providerSubStatus',
  'providerSecondaryStatus',
  'providerReturnStatus',
  'situation',
  'normalizedStatus',
  'reference',
  'recipientName',
  'recipientPhone',
  'address',
  'city',
  'cityId',
  'codAmount',
  'fee',
  'currency',
  'nature',
  'productNature',
  'note',
  'comment',
  'lastActionAt',
  'providerCreatedAt',
  'providerUpdatedAt',
  'createdAt',
  'updatedAt',
  'events',
] as const;

const EVENT_COMMON_KEYS = [
  'id',
  'eventType',
  'providerStatus',
  'providerSubStatus',
  'providerSecondaryStatus',
  'normalizedStatus',
  'statusName',
  'statusColor',
  'message',
  'actor',
  'proofImageUrl',
  'eventAt',
] as const;

const SYNC_COMMON_KEYS = [
  'success',
  'message',
  'syncedAt',
  'selected',
  'processed',
  'imported',
  'refreshed',
  'reconciled',
  'failed',
  'importFailed',
  'failures',
  'importFailures',
  'nextPage',
] as const;
