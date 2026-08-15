import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShippingShipmentStatus,
  type OzoneExpressShipment,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OzoneExpressParcelDto } from './dto/ozoneexpress-parcel.dto';
import type {
  OzoneExpressShipmentQueryDto,
  OzoneExpressSyncQueryDto,
} from './dto/ozoneexpress-shipment-query.dto';
import { OzoneExpressClient } from './ozoneexpress.client';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';
import {
  normalizeOzoneExpressStatus,
  normalizeOzoneExpressStatusCode,
  ozoneFeeForStatus,
} from './ozoneexpress-status';

type ProviderRecord = Record<string, unknown>;

type ParcelInfo = {
  providerCode: string;
  reference: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  address: string | null;
  city: string | null;
  cityId: number | null;
  codAmount: Prisma.Decimal | null;
  deliveredPrice: Prisma.Decimal | null;
  returnedPrice: Prisma.Decimal | null;
  refusedPrice: Prisma.Decimal | null;
  note: string | null;
  nature: string | null;
  stock: number | null;
  canOpen: number | null;
  fragile: number | null;
  replacement: number | null;
};

@Injectable()
export class OzoneExpressShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: OzoneExpressClient,
    private readonly connection: OzoneExpressConnectionService,
  ) {}

  async persistCreatedParcel(
    userId: string,
    request: OzoneExpressParcelDto,
    response: unknown,
  ) {
    const parcel = findNestedRecord(response, 'NEW-PARCEL');
    if (!parcel) throw malformedResponse('ADD-PARCEL.NEW-PARCEL');
    const info = parcelInfo(parcel, request);
    return this.persistInfo(userId, info, response, true);
  }

  async reconcileParcelInfo(
    userId: string,
    providerCode: string,
    response: unknown,
  ) {
    const infoRecord = findNestedRecord(response, 'INFOS');
    if (!infoRecord) throw malformedResponse('PARCEL-INFO.INFOS');
    const info = parcelInfo(infoRecord);
    if (info.providerCode !== providerCode) {
      throw new BadGatewayException(
        'OzoneExpress returned a different parcel tracking number',
      );
    }
    return this.persistInfo(userId, info, response, false);
  }

  async reconcileTracking(userId: string, response: unknown) {
    const envelopes = trackingEnvelopes(response);
    if (envelopes.length === 0) throw malformedResponse('TRACKING');
    for (const envelope of envelopes) {
      await this.persistTrackingEnvelope(userId, envelope);
    }
    return { reconciled: envelopes.length };
  }

  async refresh(userId: string, providerCode: string) {
    const credentials = await this.connection.getCredentials(userId);
    const [infoResponse, trackingResponse] = await Promise.all([
      this.client.getParcelInfo(credentials, providerCode),
      this.client.track(credentials, providerCode),
    ]);
    await this.reconcileParcelInfo(userId, providerCode, infoResponse);
    await this.reconcileTracking(userId, trackingResponse);
    return this.getByProviderCode(userId, providerCode);
  }

  async sync(userId: string, query: OzoneExpressSyncQueryDto) {
    const limit = query.limit ?? 20;
    const shipments = await this.prisma.ozoneExpressShipment.findMany({
      where: {
        userId,
        normalizedStatus: {
          notIn: [
            ShippingShipmentStatus.DELIVERED,
            ShippingShipmentStatus.CANCELLED,
            ShippingShipmentStatus.RETURNED_TO_STOCK,
            ShippingShipmentStatus.RETURNED_TO_SELLER,
          ],
        },
      },
      select: { providerCode: true },
      orderBy: [{ lastActionAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });
    const failures: Array<{ providerCode: string; message: string }> = [];
    let refreshed = 0;
    for (const shipment of shipments) {
      try {
        await this.refresh(userId, shipment.providerCode);
        refreshed += 1;
      } catch (error) {
        failures.push({
          providerCode: shipment.providerCode,
          message: safeErrorMessage(error),
        });
      }
    }
    const syncedAt = new Date();
    await this.connection.updateSyncHealth(
      userId,
      failures.length === shipments.length && shipments.length > 0
        ? null
        : syncedAt,
      failures.length
        ? `${failures.length} OzoneExpress parcel refreshes failed`
        : null,
    );
    return {
      success: failures.length === 0,
      message: failures.length
        ? 'OzoneExpress shipments synchronized with partial failures'
        : 'OzoneExpress shipments synchronized',
      selected: shipments.length,
      refreshed,
      failed: failures.length,
      syncedAt: syncedAt.toISOString(),
      failures,
    };
  }

  async getByProviderCode(userId: string, providerCode: string) {
    const shipment = await this.prisma.ozoneExpressShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      include: { events: { orderBy: { eventAt: 'desc' } } },
    });
    if (!shipment) {
      throw new NotFoundException('Stored OzoneExpress shipment was not found');
    }
    return shipmentDetails(shipment);
  }

  async getTimeline(userId: string, providerCode: string) {
    const shipment = await this.prisma.ozoneExpressShipment.findUnique({
      where: { userId_providerCode: { userId, providerCode } },
      select: {
        providerCode: true,
        providerStatus: true,
        normalizedStatus: true,
        lastActionAt: true,
        events: { orderBy: { eventAt: 'desc' } },
      },
    });
    if (!shipment) {
      throw new NotFoundException('Stored OzoneExpress shipment was not found');
    }
    return {
      providerCode: shipment.providerCode,
      providerStatus: shipment.providerStatus,
      normalizedStatus: shipment.normalizedStatus,
      lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
      events: shipment.events.map(eventResponse),
    };
  }

  async list(userId: string, query: OzoneExpressShipmentQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();
    const where: Prisma.OzoneExpressShipmentWhereInput = {
      userId,
      ...(query.status ? { normalizedStatus: query.status } : {}),
      ...(search
        ? {
            OR: [
              { providerCode: { contains: search, mode: 'insensitive' } },
              { reference: { contains: search, mode: 'insensitive' } },
              { recipientName: { contains: search, mode: 'insensitive' } },
              { recipientPhone: { contains: search } },
              { address: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [total, shipments] = await Promise.all([
      this.prisma.ozoneExpressShipment.count({ where }),
      this.prisma.ozoneExpressShipment.findMany({
        where,
        orderBy: [
          { lastActionAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: shipments.map(shipmentSummary),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async persistInfo(
    userId: string,
    info: ParcelInfo,
    response: unknown,
    created: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const [connection, current] = await Promise.all([
        tx.ozoneExpressConnection.findUnique({
          where: { userId },
          select: { id: true },
        }),
        tx.ozoneExpressShipment.findUnique({
          where: {
            userId_providerCode: {
              userId,
              providerCode: info.providerCode,
            },
          },
          select: { providerStatus: true, normalizedStatus: true },
        }),
      ]);
      const dispatch = info.reference
        ? await tx.ecommerceOrderDispatch.findFirst({
            where: {
              provider: 'OZONEEXPRESS',
              merchantTracking: info.reference,
              order: { connection: { store: { userId } } },
            },
            select: { id: true },
          })
        : null;
      const providerStatus = current?.providerStatus ?? 'Nouveau Colis';
      const normalizedStatus =
        current?.normalizedStatus ??
        normalizeOzoneExpressStatus(providerStatus);
      const fee = ozoneFeeForStatus(normalizedStatus, info);
      const now = new Date();
      const shipment = await tx.ozoneExpressShipment.upsert({
        where: {
          userId_providerCode: {
            userId,
            providerCode: info.providerCode,
          },
        },
        create: {
          userId,
          connectionId: connection?.id,
          dispatchId: dispatch?.id,
          providerStatus,
          normalizedStatus,
          ...info,
          fee,
          lastActionAt: now,
        },
        update: {
          connectionId: connection?.id,
          ...(dispatch?.id ? { dispatchId: dispatch.id } : {}),
          ...info,
          fee,
        },
      });
      if (created) {
        await tx.ozoneExpressTrackingEvent.upsert({
          where: {
            shipmentId_providerEventKey: {
              shipmentId: shipment.id,
              providerEventKey: 'created:NOUVEAU_COLIS',
            },
          },
          create: {
            shipmentId: shipment.id,
            providerEventKey: 'created:NOUVEAU_COLIS',
            eventType: 'parcel.created',
            providerStatus,
            normalizedStatus,
            actor: 'OzoneExpress',
            eventAt: now,
            rawPayload: jsonValue(response),
          },
          update: { rawPayload: jsonValue(response) },
        });
      }
      return shipment;
    });
  }

  private async persistTrackingEnvelope(
    userId: string,
    envelope: ProviderRecord,
  ) {
    const providerCode = requiredString(
      first(envelope, 'TRACKING-NUMBER', 'TRACKING_NUMBER'),
      'TRACKING.TRACKING-NUMBER',
    );
    const history = trackingHistory(envelope);
    const latestRecord =
      record(envelope.LAST_TRACKING) ?? history.at(-1)?.record ?? null;
    if (!latestRecord) throw malformedResponse('TRACKING.LAST_TRACKING');
    const providerStatus = requiredString(
      first(latestRecord, 'STATUT', 'STATUS'),
      'TRACKING.LAST_TRACKING.STATUT',
    );
    const normalizedStatus = normalizeOzoneExpressStatus(providerStatus);
    const lastActionAt = trackingDate(latestRecord) ?? new Date();

    return this.prisma.$transaction(async (tx) => {
      const [connection, current] = await Promise.all([
        tx.ozoneExpressConnection.findUnique({
          where: { userId },
          select: { id: true },
        }),
        tx.ozoneExpressShipment.findUnique({
          where: { userId_providerCode: { userId, providerCode } },
          select: {
            deliveredPrice: true,
            returnedPrice: true,
            refusedPrice: true,
          },
        }),
      ]);
      const prices = {
        deliveredPrice: current?.deliveredPrice ?? null,
        returnedPrice: current?.returnedPrice ?? null,
        refusedPrice: current?.refusedPrice ?? null,
      };
      const shipment = await tx.ozoneExpressShipment.upsert({
        where: { userId_providerCode: { userId, providerCode } },
        create: {
          userId,
          connectionId: connection?.id,
          providerCode,
          providerStatus,
          normalizedStatus,
          reference: providerCode,
          fee: ozoneFeeForStatus(normalizedStatus, prices),
          lastActionAt,
        },
        update: {
          connectionId: connection?.id,
          providerStatus,
          normalizedStatus,
          fee: ozoneFeeForStatus(normalizedStatus, prices),
          lastActionAt,
        },
      });
      const events = history.length
        ? appendLatestTracking(history, latestRecord)
        : [{ key: 'latest', record: latestRecord }];
      for (const item of events) {
        const status =
          optionalString(first(item.record, 'STATUT', 'STATUS')) ??
          providerStatus;
        const eventAt = trackingDate(item.record) ?? lastActionAt;
        const statusCode = normalizeOzoneExpressStatusCode(status) ?? 'UNKNOWN';
        const timeKey =
          optionalString(item.record.TIME) ??
          optionalString(item.record.TIME_STR) ??
          item.key;
        await tx.ozoneExpressTrackingEvent.upsert({
          where: {
            shipmentId_providerEventKey: {
              shipmentId: shipment.id,
              providerEventKey: `tracking:${timeKey}:${statusCode}`,
            },
          },
          create: {
            shipmentId: shipment.id,
            providerEventKey: `tracking:${timeKey}:${statusCode}`,
            eventType: 'parcel.status',
            providerStatus: status,
            normalizedStatus: normalizeOzoneExpressStatus(status),
            message: optionalString(item.record.COMMENT),
            actor: 'OzoneExpress',
            eventAt,
            rawPayload: jsonValue(item.record),
          },
          update: {
            normalizedStatus: normalizeOzoneExpressStatus(status),
            message: optionalString(item.record.COMMENT),
            rawPayload: jsonValue(item.record),
          },
        });
      }
      return shipment;
    });
  }
}

function parcelInfo(
  value: ProviderRecord,
  request?: OzoneExpressParcelDto,
): ParcelInfo {
  const providerCode = requiredString(
    first(value, 'TRACKING-NUMBER', 'TRACKING_NUMBER'),
    'TRACKING-NUMBER',
  );
  return {
    providerCode,
    reference: request?.trackingNumber ?? providerCode,
    recipientName: optionalString(value.RECEIVER) ?? request?.receiver ?? null,
    recipientPhone: optionalString(value.PHONE) ?? request?.phone ?? null,
    address: optionalString(value.ADDRESS) ?? request?.address ?? null,
    city: optionalString(first(value, 'CITY_NAME', 'CITY')),
    cityId: optionalInteger(value.CITY_ID) ?? optionalInteger(request?.city),
    codAmount:
      optionalDecimal(first(value, 'PRICE', 'COD')) ??
      optionalDecimal(request?.price),
    deliveredPrice: optionalDecimal(value['DELIVERED-PRICE']),
    returnedPrice: optionalDecimal(value['RETURNED-PRICE']),
    refusedPrice: optionalDecimal(value['REFUSED-PRICE']),
    note: optionalString(value.NOTE) ?? request?.note ?? null,
    nature:
      optionalString(first(value, 'NATURE', 'PRODUCT_NATURE')) ??
      request?.nature ??
      null,
    stock: optionalInteger(value.STOCK) ?? request?.stock ?? null,
    canOpen:
      optionalInteger(first(value, 'OPEN', 'CAN_OPEN')) ??
      request?.open ??
      null,
    fragile: optionalInteger(value.FRAGILE) ?? request?.fragile ?? null,
    replacement:
      optionalInteger(first(value, 'REPLACE', 'REPLACEMENT')) ??
      request?.replace ??
      null,
  };
}

function trackingEnvelopes(value: unknown): ProviderRecord[] {
  const found: ProviderRecord[] = [];
  const visit = (candidate: unknown) => {
    const item = record(candidate);
    if (!item) return;
    if (
      first(item, 'TRACKING-NUMBER', 'TRACKING_NUMBER') !== undefined &&
      (item.HISTORY !== undefined || item.LAST_TRACKING !== undefined)
    ) {
      found.push(item);
      return;
    }
    for (const nested of Object.values(item)) {
      if (Array.isArray(nested)) nested.forEach(visit);
      else visit(nested);
    }
  };
  visit(value);
  return found;
}

function trackingHistory(envelope: ProviderRecord) {
  const history = record(envelope.HISTORY);
  if (!history) return [];
  return Object.entries(history)
    .flatMap(([key, value]) => {
      const item = record(value);
      return item ? [{ key, record: item }] : [];
    })
    .sort((left, right) => {
      const leftDate = trackingDate(left.record)?.getTime() ?? 0;
      const rightDate = trackingDate(right.record)?.getTime() ?? 0;
      return leftDate - rightDate;
    });
}

function appendLatestTracking(
  history: Array<{ key: string; record: ProviderRecord }>,
  latest: ProviderRecord,
) {
  const latestTime =
    optionalString(latest.TIME) ?? optionalString(latest.TIME_STR);
  const latestStatus = optionalString(first(latest, 'STATUT', 'STATUS'));
  const alreadyIncluded = history.some(
    ({ record: item }) =>
      (optionalString(item.TIME) ?? optionalString(item.TIME_STR)) ===
        latestTime &&
      optionalString(first(item, 'STATUT', 'STATUS')) === latestStatus,
  );
  return alreadyIncluded
    ? history
    : [...history, { key: 'latest', record: latest }];
}

function trackingDate(value: ProviderRecord): Date | null {
  const epoch = optionalInteger(value.TIME);
  if (epoch !== null) {
    const date = new Date(epoch * 1000);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const text = optionalString(value.TIME_STR);
  if (!text) return null;
  const isoLike = text.includes('T') ? text : text.replace(' ', 'T');
  const parsed = new Date(
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoLike) ? isoLike : `${isoLike}Z`,
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function shipmentSummary(shipment: OzoneExpressShipment) {
  return {
    id: shipment.id,
    provider: 'ozoneexpress' as const,
    providerCode: shipment.providerCode,
    providerStatus: shipment.providerStatus,
    normalizedStatus: shipment.normalizedStatus,
    reference: shipment.reference,
    recipientName: shipment.recipientName,
    recipientPhone: shipment.recipientPhone,
    address: shipment.address,
    city: shipment.city,
    cityId: shipment.cityId,
    codAmount: shipment.codAmount?.toFixed(4) ?? null,
    fee: shipment.fee?.toFixed(4) ?? null,
    currency: shipment.currency,
    productName: shipment.nature,
    nature: shipment.nature,
    note: shipment.note,
    lastActionAt: shipment.lastActionAt?.toISOString() ?? null,
    providerCreatedAt: shipment.providerCreatedAt?.toISOString() ?? null,
    providerUpdatedAt: shipment.providerUpdatedAt?.toISOString() ?? null,
    createdAt: shipment.createdAt.toISOString(),
    updatedAt: shipment.updatedAt.toISOString(),
  };
}

function shipmentDetails(
  shipment: OzoneExpressShipment & {
    events: Array<{
      id: string;
      eventType: string;
      providerStatus: string;
      normalizedStatus: OzoneExpressShipment['normalizedStatus'];
      message: string | null;
      actor: string | null;
      eventAt: Date;
    }>;
  },
) {
  return {
    ...shipmentSummary(shipment),
    address: shipment.address,
    deliveredPrice: shipment.deliveredPrice?.toFixed(4) ?? null,
    returnedPrice: shipment.returnedPrice?.toFixed(4) ?? null,
    refusedPrice: shipment.refusedPrice?.toFixed(4) ?? null,
    note: shipment.note,
    nature: shipment.nature,
    stock: shipment.stock,
    canOpen: shipment.canOpen,
    fragile: shipment.fragile,
    replacement: shipment.replacement,
    events: shipment.events.map(eventResponse),
  };
}

function eventResponse(event: {
  id: string;
  eventType: string;
  providerStatus: string;
  normalizedStatus: OzoneExpressShipment['normalizedStatus'];
  message: string | null;
  actor: string | null;
  eventAt: Date;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    providerStatus: event.providerStatus,
    normalizedStatus: event.normalizedStatus,
    message: event.message,
    actor: event.actor,
    eventAt: event.eventAt.toISOString(),
  };
}

function findNestedRecord(
  value: unknown,
  wantedKey: string,
): ProviderRecord | null {
  const root = record(value);
  if (!root) return null;
  const direct = record(root[wantedKey]);
  if (direct) return direct;
  for (const nested of Object.values(root)) {
    const found = findNestedRecord(nested, wantedKey);
    if (found) return found;
  }
  return null;
}

function record(value: unknown): ProviderRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ProviderRecord)
    : null;
}

function first(recordValue: ProviderRecord, ...keys: string[]) {
  for (const key of keys) {
    if (recordValue[key] !== undefined && recordValue[key] !== null) {
      return recordValue[key];
    }
  }
  return undefined;
}

function requiredString(value: unknown, field: string) {
  const result = optionalString(value);
  if (!result) throw malformedResponse(field);
  return result;
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function optionalDecimal(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  try {
    return new Prisma.Decimal(value as Prisma.Decimal.Value);
  } catch {
    return null;
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function malformedResponse(field: string) {
  return new BadGatewayException(
    `OzoneExpress returned a malformed response: missing ${field}`,
  );
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 500)
    : 'OzoneExpress parcel refresh failed';
}
